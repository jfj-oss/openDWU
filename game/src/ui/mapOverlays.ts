// Map overlay toggle state (task 05c). The original's minimap-area buttons
// (btnMapOverlay1..8, btnMapCivilianFade in Main.Part12.cs) are replaced by a
// list of named toggles; the overlays are drawn by src/render/overlayLayer.ts (and builtObjectLayer.ts / empireLayer.ts).

import { improvementEnabled, type ImprovementId } from './improvements'; // [dw2overlays]

export interface MapOverlayState {
    fleetPostures: boolean;
    travelVectorsState: boolean;
    travelVectorsPrivate: boolean;
    potentialColonies: boolean;
    scenicLocations: boolean;
    researchLocations: boolean;
    longRangeScanners: boolean;
    empireTerritory: boolean;
    /** Galaxy/sector-zoom faction rings + ship/base symbols (render/galaxyMarkers.ts). */
    factionMarkers: boolean;
    /** Small station/colony presence discs; shown only while Empire Territory is off (render/galaxyMarkers.ts). */
    stationPresence: boolean;
    fadeCivilianShips: boolean;
    // [freightOverlay] begin — task 19e-9 additions (not in the original's nine).
    freightFlows: boolean;
    tradeHubs: boolean;
    // [freightOverlay] end
    /** Scenario threats (19b/19f): farms, nests, carriers the player knows of (framework threatKnownSites). */
    threats: boolean;
    /** Scenario 19e-7: debris fields of battle wreckage the player knows (wreck markers + hover tooltip). */
    wrecks: boolean;
    // [dw2overlays] begin — Distant Worlds 2-style additions (not in the original): UI-only reads of what the player knows.
    /** Colony Target Scores: the Expansion Planner's colonization targets as rings coloured by their score, around the
     *  habitat at system zoom and the system's best target at galaxy / sector zoom (render/colonyTargets.ts). Extends
     *  Potential Colonies (whose plain rings give way to these on the scored habitats). */
    colonyScores: boolean;
    /** Known resources per system / habitat as icons (render/resourceOverlay.ts); the "…" panel picks one resource. */
    resources: boolean;
    /** The selected ship / fleet's fuel reach and the refuelling points it can use (render/fuelOverlay.ts). */
    fuelRange: boolean;
    // [dw2overlays] end
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
        // On: faint galaxy-level faction markers and the presence discs (the latter only draw with territory off).
        factionMarkers: true,
        stationPresence: true,
        fadeCivilianShips: false,
        // [freightOverlay] begin
        freightFlows: false,
        tradeHubs: false,
        // [freightOverlay] end
        // On: it only ever draws what the player has discovered in a scenario game (nothing without one).
        threats: true,
        // On, like Threats: only draws in a wreckage-scenario game.
        wrecks: true,
        // [dw2overlays] begin — off, like every addition.
        colonyScores: false,
        resources: false,
        fuelRange: false,
        // [dw2overlays] end
    };
}

export type OverlayKey = keyof MapOverlayState;

/** What a row's "…" button opens: the Trade Flows screen, or an inline options panel under the row
 * (ui/overlayOptionPanels.ts). */
export type OverlayPanel = 'tradeFlows' | 'resources';

/** Human label per overlay key, in display order for the options list. `mod: true` marks rows that are additions to
 * the original (rendered with a small "+" badge); `panel` names what the row's "…" button opens. */
export const OVERLAY_ROWS: Array<{ key: OverlayKey; label: string; mod?: boolean; panel?: OverlayPanel }> = [
    { key: 'fleetPostures', label: 'Fleet Postures' },
    { key: 'travelVectorsState', label: 'Travel Vectors (State)' },
    { key: 'travelVectorsPrivate', label: 'Travel Vectors (Private)' },
    { key: 'potentialColonies', label: 'Potential Colonies' },
    { key: 'scenicLocations', label: 'Scenic Locations' },
    { key: 'researchLocations', label: 'Research Locations' },
    { key: 'longRangeScanners', label: 'Long Range Scanners' },
    { key: 'empireTerritory', label: 'Empire Territory' },
    { key: 'factionMarkers', label: 'Faction markers', mod: true },
    { key: 'stationPresence', label: 'Station presence', mod: true },
    { key: 'fadeCivilianShips', label: 'Fade civilian ships and bases' },
    // [freightOverlay] begin
    { key: 'freightFlows', label: 'Freight Flows', mod: true, panel: 'tradeFlows' },
    { key: 'tradeHubs', label: 'Trade Hubs', mod: true, panel: 'tradeFlows' },
    // [freightOverlay] end
    { key: 'threats', label: 'Threats' },
    { key: 'wrecks', label: 'Wreck Fields', mod: true },
];

// [dw2overlays] begin
/** The overlays of the "Improvements" category (ui/improvements.ts): their own section of the View popup, below the
 * original's Overlays, each shown only while its improvement is enabled in Game Options. */
export const IMPROVEMENT_OVERLAY_ROWS: Array<{ key: OverlayKey; label: string; improvement: ImprovementId; panel?: OverlayPanel }> = [
    { key: 'colonyScores', label: 'Colony Target Scores', improvement: 'colonyTargetScores' },
    { key: 'resources', label: 'Resources', improvement: 'resourcesOverlay', panel: 'resources' },
    { key: 'fuelRange', label: 'Fuel Range', improvement: 'fuelRangeOverlay' },
];

/** An Improvements overlay draws while its toggle is on and its improvement is enabled. */
export function improvementOverlayOn(state: MapOverlayState, key: OverlayKey): boolean {
    if (!state[key]) return false;
    const row = IMPROVEMENT_OVERLAY_ROWS.find((r) => r.key === key);
    return row === undefined || improvementEnabled(row.improvement);
}
// [dw2overlays] end

// [dw2overlays] begin
/** The non-boolean overlay settings of one MapOverlayState (the "…" panels). */
export interface MapOverlayOptions {
    /** Resources overlay: show only this resource id (null = every known resource). */
    resourceFilter: number | null;
}

const overlayOptions = new WeakMap<MapOverlayState, MapOverlayOptions>();

/** The options that go with `state` (created on first use: no filter). */
export function overlayOptionsOf(state: MapOverlayState): MapOverlayOptions {
    let o = overlayOptions.get(state);
    if (o === undefined) {
        o = { resourceFilter: null };
        overlayOptions.set(state, o);
    }
    return o;
}

/** Set the Resources overlay's resource filter (null = all) and notify the subscribers, as a toggle does. */
export function setOverlayResourceFilter(state: MapOverlayState, resourceId: number | null): void {
    const o = overlayOptionsOf(state);
    if (o.resourceFilter === resourceId) return;
    o.resourceFilter = resourceId;
    for (const fn of listeners) fn();
}

/** Turn one overlay flag on or off (no-op when it already is), notifying like toggleOverlay. */
export function setOverlay(state: MapOverlayState, key: OverlayKey, on: boolean): void {
    if (state[key] !== on) toggleOverlay(state, key);
}
// [dw2overlays] end

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