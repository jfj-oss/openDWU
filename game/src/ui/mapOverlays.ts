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
}

/** A fresh overlay state: everything off. */
export function createMapOverlayState(): MapOverlayState {
    return {
        fleetPostures: false,
        travelVectorsState: false,
        travelVectorsPrivate: false,
        potentialColonies: false,
        scenicLocations: false,
        researchLocations: false,
        longRangeScanners: false,
        empireTerritory: false,
        fadeCivilianShips: false,
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
];

/** Toggle one overlay flag in place. */
export function toggleOverlay(state: MapOverlayState, key: OverlayKey): void {
    state[key] = !state[key];
}