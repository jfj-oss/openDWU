// Scenario component scaling (not in the original): a scenario may scale components' Value1 / Value2 (BVR combat's weapon and
// sensor ranges) in the galaxy's static component tables. Applied once to freshly built tables: at galaxy creation, after a save
// is loaded (the tables are rebuilt from the game data, the saved graph already holds the scaled values it used) and on a
// replica galaxy. A game with no scenario, or none that answers the query, is untouched (no table change, no Rnd).

import type { Galaxy } from '../galaxy';
import { rebuildOrderedComponentLists } from '../componentStatic';
import { scenarioQuery } from './hooks';

/** Tables already scaled (a table set is scaled once, however many times a wire-up calls this). */
const scaled = new WeakSet<object>();

export function applyScenarioComponentScale(galaxy: Galaxy): void {
    if (galaxy.scenario === null) return;
    const cs = galaxy.researchStatic?.componentStatic ?? null;
    if (cs === null || scaled.has(cs)) return;
    scaled.add(cs);
    const scaleOf = new Map<number, { value1: number; value2: number } | null>();
    let any = false;
    for (const def of cs.definitions) {
        const k = scenarioQuery(galaxy, 'componentValueScale', { value1: 100, value2: 100 }, { component: def });
        if (k.value1 === 100 && k.value2 === 100) {
            scaleOf.set(def.componentId, null);
            continue;
        }
        scaleOf.set(def.componentId, k);
        any = true;
        def.value1 = Math.round((def.value1 * k.value1) / 100);
        def.value2 = Math.round((def.value2 * k.value2) / 100);
    }
    if (!any) return;
    for (const project of cs.researchProjects) {
        for (const imp of project.improvements) {
            const k = scaleOf.get(imp.improvedComponent.componentId);
            if (k == null) continue;
            imp.value1 = Math.round((imp.value1 * k.value1) / 100);
            imp.value2 = Math.round((imp.value2 * k.value2) / 100);
        }
    }
    rebuildOrderedComponentLists(cs);
}
