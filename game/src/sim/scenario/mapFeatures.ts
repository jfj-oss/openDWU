// Scenario map features (mod layer, 19a treasure fleet): markers at galaxy zoom and route polylines on the freight
// overlay, supplied by scenario packages. Not a port. Read-only views of the galaxy: providers never change sim state or
// draw galaxy.rnd (the renderer calls them every few frames).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';

export interface ScenarioMapMarker {
    x: number;
    y: number;
    /** Label drawn beside the marker. */
    label: string;
    /** 0xRRGGBB. */
    color: number;
}

export interface ScenarioMapRoute {
    /** World points, in order (a closed circuit repeats its first point at the end). */
    points: { x: number; y: number }[];
    color: number;
    /** Index of the leg currently sailed (drawn brighter); -1 = none. */
    activeLeg: number;
}

export interface ScenarioMapFeatures {
    markers: ScenarioMapMarker[];
    routes: ScenarioMapRoute[];
}

export type ScenarioMapFeatureProvider = (galaxy: Galaxy, viewer: Empire | null) => ScenarioMapFeatures | null;

const providers = new Map<string, ScenarioMapFeatureProvider>();

/** Registers (or replaces, by id) a provider. Returns an unregister function. */
export function registerScenarioMapFeatures(id: string, provider: ScenarioMapFeatureProvider): () => void {
    providers.set(id, provider);
    return () => {
        if (providers.get(id) === provider) providers.delete(id);
    };
}

/** Every provider's features for `viewer` (empty without a scenario), providers in id order. */
export function scenarioMapFeatures(galaxy: Galaxy, viewer: Empire | null): ScenarioMapFeatures {
    const out: ScenarioMapFeatures = { markers: [], routes: [] };
    if (galaxy.scenario === null) return out;
    for (const id of [...providers.keys()].sort()) {
        const f = providers.get(id)!(galaxy, viewer);
        if (f === null) continue;
        out.markers.push(...f.markers);
        out.routes.push(...f.routes);
    }
    return out;
}
