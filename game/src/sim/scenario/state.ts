// Scenario state on the galaxy and the flag readers (tasks/MODLAYER-DESIGN.md §2). Not a port.
//
// Every scenario branch in the sim is `if (scenarioFlag(galaxy, 'name'))`: with no scenario galaxy.scenario is null and
// every reader returns its "off" value without touching galaxy state or galaxy.rnd.

import type { Galaxy } from '../galaxy';
import type { Resource } from '../data/resources';
import type { ScenarioManifest } from './manifest';

/** A resolved resource placement rule (resource name → id at game creation). */
export interface ScenarioResourceRule {
    resourceId: number;
    minRadius: number;
    maxRadius: number;
}

/** Galaxy.scenario: the chosen scenario, its resolved switches and the state its packages keep (saved with the game). */
export class GalaxyScenario {
    id = '';
    name = '';
    /** The manifest as loaded (plain JSON data). */
    manifest: ScenarioManifest | null = null;
    /** Resolved flag values (manifest defaults overridden by the wizard's choice). */
    flags: Record<string, boolean> = {};
    /** Resolved numeric params. */
    params: Record<string, number> = {};
    /** Resolved resource placement rules (empty = hook off). */
    resourceRules: ScenarioResourceRule[] = [];
    /** Game year (floor(starDate / YEAR_LENGTH)) the yearly tick last ran for; -1 = not yet anchored. */
    lastYear = -1;
    /** Per-package state (scenarioState). Values must be saveable: plain data, galaxy graph objects, registered classes. */
    state: Record<string, unknown> = {};
}

/** The wizard's / a test's choice: flag and param overrides of the manifest defaults. */
export interface ScenarioChoice {
    flags?: Record<string, boolean>;
    params?: Record<string, number>;
}

/** Builds galaxy.scenario from a manifest and the chosen overrides (unknown names are ignored). */
export function createGalaxyScenario(manifest: ScenarioManifest, choice: ScenarioChoice = {}, resources: readonly Resource[] = []): GalaxyScenario {
    const s = new GalaxyScenario();
    s.id = manifest.id;
    s.name = manifest.name;
    s.manifest = JSON.parse(JSON.stringify(manifest)) as ScenarioManifest;
    for (const f of manifest.flags) s.flags[f.name] = choice.flags?.[f.name] ?? f.default;
    for (const p of manifest.params) {
        let v = choice.params?.[p.name] ?? p.default;
        if (!Number.isFinite(v)) v = p.default;
        if (p.min !== undefined) v = Math.max(p.min, v);
        if (p.max !== undefined) v = Math.min(p.max, v);
        s.params[p.name] = v;
    }
    for (const r of manifest.resourcePlacement) {
        const res = resources.find((x) => x.name.toLowerCase() === r.resource.toLowerCase());
        if (res !== undefined) s.resourceRules.push({ resourceId: res.resourceId, minRadius: r.minRadius, maxRadius: r.maxRadius });
    }
    return s;
}

/** True when the game runs a scenario (any scenario, flags aside). */
export function scenarioActive(galaxy: Galaxy): boolean {
    return galaxy.scenario !== null;
}

/** The value of a scenario flag; false with no scenario or an unknown flag. */
export function scenarioFlag(galaxy: Galaxy, name: string): boolean {
    const s = galaxy.scenario;
    return s !== null && s.flags[name] === true;
}

/** A scenario param; `fallback` with no scenario or an unknown param. */
export function scenarioParam(galaxy: Galaxy, name: string, fallback: number): number {
    const s = galaxy.scenario;
    if (s === null) return fallback;
    const v = s.params[name];
    return typeof v === 'number' ? v : fallback;
}

/**
 * A package's saved state bag: `init()` creates it on first use. Throws with no scenario (scenario code only runs
 * behind a flag, so reaching this without one is a bug).
 */
export function scenarioState<T>(galaxy: Galaxy, key: string, init: () => T): T {
    const s = galaxy.scenario;
    if (s === null) throw new Error(`scenarioState(${key}): no scenario in this game`);
    if (!(key in s.state)) s.state[key] = init();
    return s.state[key] as T;
}
