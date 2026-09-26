// Map overlay toggle state (task 05c). The original's minimap-area buttons
// (btnMapOverlay1..8, btnMapCivilianFade in Main.Part12.cs) are replaced by a
// list of named toggles; rendering of the overlays themselves comes later.

export interface MapOverlayState {
    fleetPostures: boolean;
    travelVectorsState: boolean;
    travelVectorsPrivate: boolean;
    potentialColonies: boolean;
    scenicLocations: boolean;
    researchLocations: boolean;
    longRangeScanners: boolean;
    empireTerritory: boolean;
    fadeCivilianShips: boolean;
    /** Scenario threats (19b/19f): farms, nests, carriers the player knows of (framework threatKnownSites). */
    threats: boolean;
}

/** A fresh overlay state. Task M3: `empireTerritory` starts on, matching the
 * original's behaviour — GameOptions.MapOverlayEmpireTerritory itself
 * defaults false, but that flag only chooses between two territory-shading
 * *algorithms* (GalaxyMap.cs: CalculateEmpireTerritoryGrid vs
 * CalculateEmpireSystemTerritory); the original always shades territory.
 * This renderer draws one disc style, so the toggle controls visibility
 * instead, and starts on to match "territory is always shown". The rest
 * default off, same as every other overlay in the original. */
export function createMapOverlayState(): MapOverlayState {
    return {
        fleetPostures: false,
        travelVectorsState: false,
        travelVectorsPrivate: false,
        potentialColonies: false,
        scenicLocations: false,
        researchLocations: false,
        longRangeScanners: false,
        empireTerritory: true,
        fadeCivilianShips: false,
        // On: it only ever draws what the player has discovered in a scenario game (nothing without one).
        threats: true,
    };
}

export type OverlayKey = keyof MapOverlayState;

/** Human label per overlay key, in display order for the options list. */
export const OVERLAY_ROWS: Array<{ key: OverlayKey; label: string }> = [
    { key: 'fleetPostures', label: 'Fleet Postures' },
    { key: 'travelVectorsState', label: 'Travel Vectors (State)' },
    { key: 'travelVectorsPrivate', label: 'Travel Vectors (Private)' },
    { key: 'potentialColonies', label: 'Potential Colonies' },
    { key: 'scenicLocations', label: 'Scenic Locations' },
    { key: 'researchLocations', label: 'Research Locations' },
    { key: 'longRangeScanners', label: 'Long Range Scanners' },
    { key: 'empireTerritory', label: 'Empire Territory' },
    { key: 'fadeCivilianShips', label: 'Fade civilian ships and bases' },
    { key: 'threats', label: 'Threats' },
];

/** Toggle one overlay flag in place, then notify subscribers (task M3: lets
 * overlayLayer.ts react to a toggle without waiting for the next frame that
 * happens to re-read the state anyway). */
export function toggleOverlay(state: MapOverlayState, key: OverlayKey): void {
    state[key] = !state[key];
    for (const fn of listeners) fn();
}

type OverlayChangeListener = () => void;
const listeners = new Set<OverlayChangeListener>();

/** Subscribe to overlay toggles (any key). Returns an unsubscribe function.
 * Task M3: module-level, since the app only ever runs one overlay state at a
 * time (main.ts creates one `MapOverlayState` and shares it with the HUD and
 * the Main View). */
export function onOverlayChange(fn: OverlayChangeListener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}