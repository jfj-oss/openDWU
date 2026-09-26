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

/** { scenarios: [...] } for every folder of `root` that has a scenario.json (its id must equal the folder name). */
export function buildScenarioIndex(root) {
    const scenarios = [];
    if (!existsSync(root)) return { scenarios };
    for (const name of readdirSync(root).sort()) {
        const dir = path.join(root, name);
        if (!statSync(dir).isDirectory() || !existsSync(path.join(dir, 'scenario.json'))) continue;
        const manifest = JSON.parse(readFileSync(path.join(dir, 'scenario.json'), 'utf8'));
        if (manifest.id !== name) throw new Error(`scenarios/${name}/scenario.json: id "${String(manifest.id)}" must equal the folder name`);
        scenarios.push({ ...manifest, id: name, files: listScenarioFiles(dir).filter((f) => f !== 'scenario.json') });
    }
    return { scenarios };
}
