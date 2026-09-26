// Browser-side scenario loading (tasks/MODLAYER-DESIGN.md §1): the index and one scenario's overlay files, through the
// same FetchText the base data uses. Scenarios are served at /assets/scenarios/ (repo folder game/scenarios/, see
// vite.config.ts scenarioAssets and the build copy). No Node APIs.

import type { FetchText } from '../data/gameData';
import { parseScenarioManifest, type ScenarioIndex, type ScenarioManifest } from './manifest';
import type { ScenarioOverlay } from './overlay';

export const SCENARIO_URL_ROOT = '/assets/scenarios';

/** /assets/scenarios/index.json → the manifests (with their file lists); empty when the index is missing or invalid. */
export async function loadScenarioIndex(fetchText: FetchText): Promise<ScenarioManifest[]> {
    let text: string;
    try {
        text = await fetchText([`${SCENARIO_URL_ROOT}/index.json`]);
    } catch {
        return [];
    }
    try {
        const raw = JSON.parse(text) as ScenarioIndex;
        const out: ScenarioManifest[] = [];
        for (const m of raw.scenarios ?? []) {
            try {
                out.push(parseScenarioManifest(m));
            } catch (err) {
                console.warn('Ignoring invalid scenario manifest', err);
            }
        }
        return out;
    } catch {
        return [];
    }
}

/** Fetches every overlay file the manifest lists (a file that fails to load is an error: the scenario is incomplete). */
export async function loadScenarioOverlay(fetchText: FetchText, manifest: ScenarioManifest): Promise<ScenarioOverlay> {
    const files = new Map<string, string>();
    const paths = manifest.files.filter((f) => f.toLowerCase() !== 'scenario.json');
    const texts = await Promise.all(paths.map((f) => fetchText([`${SCENARIO_URL_ROOT}/${manifest.id}/${f}`])));
    paths.forEach((p, i) => files.set(p, texts[i]));
    return { manifest, files };
}
