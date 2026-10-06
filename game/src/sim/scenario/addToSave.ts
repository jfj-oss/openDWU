// Adding add-ons to a saved game (the Load screen's "Add add-ons…"; the plan is addons.ts planSaveAddonAddition). Not a
// port. Applied by deserializeGame's explicit `addAddons` path right after the galaxy is rebuilt, at the load boundary
// (between frames), and journaled there as a command-log entry (player/commandLog.ts AddonsLogEntry), so seed +
// command log still replays the game: up to the entry it is the game the save was started as (its start options are
// kept), and the replay applies the same switch change at the same boundary (playerCommands.ts replayEntry).
//
// Only add-ons with nothing to set up at galaxy generation or game start are offered (manifest addableToSave): their
// handlers are gated on their flags, their state starts on first use (scenarioState) and periodic handlers anchor on
// their first tick, so switching their flags on here is all they need. No galaxy.rnd draws, no other state touched.

import type { Galaxy } from '../galaxy';
import { galaxyStarDate } from '../tick/simTime';
import { appendCommandLog, type AddonsLogEntry } from '../player/commandLog';
import { GalaxyScenario } from './state';
import { parseScenarioManifest, type ScenarioManifest } from './manifest';
import type { SaveAddonAddition } from './addons';

/** The addition as its journal entry (plain data; the replay applies it with applyAddonsLogEntry). */
export function addonsLogEntry(galaxy: Galaxy, add: SaveAddonAddition): AddonsLogEntry {
    return {
        starDate: galaxyStarDate(galaxy),
        nowMs: galaxy.nowMs,
        source: 'addons',
        added: [...add.added],
        scenario: { id: add.to.id, include: add.to.include === null ? null : [...add.to.include] },
        name: add.name,
        description: add.description,
        manifestInclude: [...add.manifestInclude],
        // Plain JSON (no undefined members), as the entry reads back from a save: live and replayed manifests match.
        newFlags: JSON.parse(JSON.stringify(add.newFlags)) as AddonsLogEntry['newFlags'],
        newParams: JSON.parse(JSON.stringify(add.newParams)) as AddonsLogEntry['newParams'],
        flags: { ...add.flags },
        params: { ...add.params },
        ...(add.withData ? { withData: true as const } : {}),
    };
}

/**
 * Switch the add-ons of a journal entry on in `galaxy`: galaxy.scenario takes the new id, manifest (the save then
 * records the combined set) and the new packages' switches. A faithful game
 * gets its first GalaxyScenario here. Plain data only, no draws.
 */
export function applyAddonsLogEntry(galaxy: Galaxy, e: AddonsLogEntry): void {
    let s = galaxy.scenario;
    if (s === null) {
        s = new GalaxyScenario();
        galaxy.scenario = s;
    }
    const old: ScenarioManifest = s.manifest ?? parseScenarioManifest({ id: e.scenario.id });
    const manifest: ScenarioManifest = JSON.parse(JSON.stringify(old)) as ScenarioManifest;
    manifest.id = e.scenario.id;
    manifest.name = e.name;
    manifest.description = e.description;
    manifest.include = [...e.manifestInclude];
    for (const f of e.newFlags) if (!manifest.flags.some((x) => x.name === f.name)) manifest.flags.push(JSON.parse(JSON.stringify(f)) as typeof f);
    for (const p of e.newParams) if (!manifest.params.some((x) => x.name === p.name)) manifest.params.push(JSON.parse(JSON.stringify(p)) as typeof p);
    s.id = e.scenario.id;
    s.name = e.name;
    s.manifest = manifest;
    // Only the new packages' names (and their master switches) are in the entry: the save's own switches are kept.
    for (const [k, v] of Object.entries(e.flags)) s.flags[k] = v;
    for (const [k, v] of Object.entries(e.params)) s.params[k] = v;
}

/** deserializeGame's addAddons step: apply the addition and journal it at this boundary. */
export function addAddonsToLoadedGalaxy(galaxy: Galaxy, add: SaveAddonAddition): void {
    const entry = addonsLogEntry(galaxy, add);
    applyAddonsLogEntry(galaxy, entry);
    appendCommandLog(galaxy, entry);
}
