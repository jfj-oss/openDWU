// Scenario map features (mod layer, 19a treasure fleet): markers at galaxy zoom and route polylines on the freight
// overlay, supplied by scenario packages. Not a port. Read-only views of the galaxy: providers never change sim state or
// draw galaxy.rnd (the renderer calls them every few frames).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';

export interface ScenarioMapMarker {
    x: number;
    y: number;
    /** Label drawn beside the marker. */
    label: string;
    /** 0xRRGGBB. */
    color: number;
    /**
     * Distinct glyph (default: the beacon ring). 'purifier' = the Purifier itself (live, or `stale` at its last spotted place),
     * 'purifierDock' = its ancient repair station. TODO(art): render/overlayLayer.ts draws all of them as the beacon ring for
     * now (stale dimmed); the real glyphs (medium, no rings / radius overlays) are still to be drawn by the art pass.
     * 'compact' = a founding world of the Founders' Compact (Giantworks; a faint emblem), 'greatWork' = a Great Work's site (TODO(art): same).
     */
    glyph?: 'purifier' | 'purifierDock' | 'compact' | 'greatWork';
    /** A stale position (the last spotted place): the glyph is drawn dim and hollow. */
    stale?: boolean;
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

/**
 * A scenario group the player has selected on the map (mod layer, 19a treasure fleet): its remaining stops and a line
 * from the lead to every member (stragglers). Drawn only while one of its ships (or its fleet) is the selection.
 */
export interface ScenarioSelectionFeature {
    color: number;
    /** The ship the lines start from (drawn at its render position). */
    lead: BuiltObject;
    /** The remaining stops in order (world points). */
    stops: { x: number; y: number }[];
    /** The other ships of the group. */
    members: BuiltObject[];
}

/** The map selection as the renderer holds it (render/mapHighlights.ts SelectedObjectLike, the parts used here). */
export interface ScenarioSelectionLike {
    builtObject?: BuiltObject;
    shipGroup?: { ships: readonly BuiltObject[] };
    builtObjects?: readonly BuiltObject[];
}

export type ScenarioSelectionProvider = (galaxy: Galaxy, selection: ScenarioSelectionLike) => ScenarioSelectionFeature | null;

const selectionProviders = new Map<string, ScenarioSelectionProvider>();

/** Registers (or replaces, by id) a selection provider. Returns an unregister function. */
export function registerScenarioSelectionFeatures(id: string, provider: ScenarioSelectionProvider): () => void {
    selectionProviders.set(id, provider);
    return () => {
        if (selectionProviders.get(id) === provider) selectionProviders.delete(id);
    };
}

/** Every selection provider's feature for `selection` (empty without a scenario or a selection), in id order. */
export function scenarioSelectionFeatures(galaxy: Galaxy, selection: ScenarioSelectionLike | null): ScenarioSelectionFeature[] {
    const out: ScenarioSelectionFeature[] = [];
    if (galaxy.scenario === null || selection === null) return out;
    for (const id of [...selectionProviders.keys()].sort()) {
        const f = selectionProviders.get(id)!(galaxy, selection);
        if (f !== null) out.push(f);
    }
    return out;
}
