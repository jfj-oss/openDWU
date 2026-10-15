// Mod layer (tasks/MODLAYER-DESIGN.md §1): builds /assets/scenarios/index.json from the repo's scenarios/ folder —
// every <id>/scenario.json plus the list of overlay files under <id>/ (the browser cannot list folders). Used by the
// Vite dev middleware / build copy (vite.config.ts) and the test harness (test/helpers/scenarioGame.ts). Node only.
// Types: scenarioIndex.d.mts.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** Files under `dir`, relative, forward slashes, sorted. */
export function listScenarioFiles(dir, rel = '') {
    const out = [];
    for (const name of readdirSync(path.join(dir, rel)).sort()) {
        const r = rel === '' ? name : `${rel}/${name}`;
        if (statSync(path.join(dir, r)).isDirectory()) out.push(...listScenarioFiles(dir, r));
        else out.push(r);
    }
    return out;
}

/**
 * openDWU Classic (DWU_EDITION=classic, vite.config.ts): the only add-ons that ship. event-log's manifest includes
 * internal-security and threat-framework (the Emergent Galaxy and hidden threats); in Classic those are not shipped, so
 * buildScenarioIndex drops every `include` / `requires` outside the allow-list. The event log itself (scenario/eventLog)
 * and the Galactic History screen read only its own `eventLog` flag and the typed log, so it works standalone.
 */
export const CLASSIC_ADDONS = ['themed-names', 'smarter-ai', 'event-log', 'orbital-superiority', 'longer-ground-combat', 'jump-interdiction', 'blockades-bite'];

/** Scenario ids a build ships: null = all (full edition), else the allow-list. */
export function editionAllowlist(edition) {
    return edition === 'classic' ? CLASSIC_ADDONS : null;
}

/** { scenarios: [...] } for every folder of `root` that has a scenario.json (its id must equal the folder name); `allow` (ids) limits it to those add-ons and prunes their include / requires to the same set. */
export function buildScenarioIndex(root, allow = null) {
    const scenarios = [];
    if (!existsSync(root)) return { scenarios };
    for (const name of readdirSync(root).sort()) {
        const dir = path.join(root, name);
        if (!statSync(dir).isDirectory() || !existsSync(path.join(dir, 'scenario.json'))) continue;
        const manifest = JSON.parse(readFileSync(path.join(dir, 'scenario.json'), 'utf8'));
        if (allow !== null && !allow.includes(name)) continue;
        if (manifest.id !== name) throw new Error(`scenarios/${name}/scenario.json: id "${String(manifest.id)}" must equal the folder name`);
        if (allow !== null) {
            for (const k of ['include', 'requires']) if (Array.isArray(manifest[k])) manifest[k] = manifest[k].filter((id) => allow.includes(id));
        }
        scenarios.push({ ...manifest, id: name, files: listScenarioFiles(dir).filter((f) => f !== 'scenario.json') });
    }
    return { scenarios };
}
