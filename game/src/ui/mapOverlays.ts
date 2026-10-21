// Map overlay toggle state (task 05c). The original's minimap-area buttons
// (btnMapOverlay1..8, btnMapCivilianFade in Main.Part12.cs) are replaced by a
// list of named toggles; the overlays are drawn by src/render/overlayLayer.ts (and builtObjectLayer.ts / empireLayer.ts).

import { isImprovementEnabled, registerImprovement } from './improvements';

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
    /** Small station/colony presence discs, drawn above Empire Territory (render/galaxyMarkers.ts). */
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
    /** Characters & Victory: the routes of the player's VIP shuttles (the gold rings are always drawn). */
    vipTraffic: boolean;
    /** Colony Economy: a badge per designated colony of the viewer (render/economyMarkers.ts; only in a game with the add-on). */
    colonyDesignations: boolean;
    // [dw2overlays] begin — Improvements (ui/improvements.ts; DW2-inspired, not in the original): UI-only reads of what
    // the player knows.
    /** Colony Target Scores: the Expansion Planner's colonization targets as rings coloured by their score, around the
     *  habitat at system zoom and the system's best target at galaxy / sector zoom (render/colonyTargets.ts). Extends
     *  Potential Colonies (whose plain rings give way to these on the scored habitats). */
    colonyScores: boolean;
    /** Known resources per system / habitat as icons (render/resourceOverlay.ts); the "…" panel picks one resource. */
    resources: boolean;
    /** The selected ship / fleet's fuel reach and the refuelling points it can use (render/fuelOverlay.ts). */
    fuelRange: boolean;
    // [dw2overlays] end
    /** Improvements (supplyChain): the player's yards stalled for resources and colonies short of luxuries
     *  (render/supplyOverlay.ts; hover tooltip). */
    supplyShortages: boolean;
    /** Improvements (waypoints): the player's waypoints and the locations the player knows of — location hints, debris
     *  fields, planet destroyers, ... (render/locationMarkers.ts; the "…" panel picks which, ui/waypoints.ts). */
    waypoints: boolean;
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
        // On: faint galaxy-level faction markers and the presence discs (the latter draw above the territory layer).
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
        // Off: only routes; the rings show regardless (Characters & Victory games only).
        vipTraffic: false,
        // On, like Wreck Fields: only draws in a Colony Economy game.
        colonyDesignations: true,
        // [dw2overlays] begin — off, like every addition.
        colonyScores: false,
        resources: false,
        fuelRange: false,
        // [dw2overlays] end
        supplyShortages: false,
        // On: the player's own pins and what the player was told of (nothing to draw until there is some).
        waypoints: true,
    };
}

export type OverlayKey = keyof MapOverlayState;

export type OverlayPanel = 'tradeFlows' | 'resources' | 'supplyShortages' | 'waypoints';

/** One row of the View popup's overlay list. */
export interface OverlayRow {
    key: OverlayKey;
    label: string;
    /** One-line hover tooltip: what the overlay shows and at which zoom. */
    hint?: string;
    /** An addition to the original (rendered with a small "+" badge). */
    mod?: boolean;
    /** What the row's "…" button opens: the Trade Flows screen, or the inline resource picker (ui/overlayOptionPanels.ts). */
    panel?: OverlayPanel;
    /** The improvement (ui/improvements.ts) the overlay belongs to: listed in the popup's Improvements section (no "+"
     *  badge) and hidden — and not drawn, overlayActive — while the improvement is off. */
    improvement?: string;
}

/** Human label per overlay key, in display order for the options list. */
export const OVERLAY_ROWS: OverlayRow[] = [
    { key: 'fleetPostures', label: 'Fleet Postures', hint: "Each of your fleets' standing orders (attack, defend, hold position and so on)." },
    { key: 'travelVectorsState', label: 'Travel Vectors (State)', hint: "Lines from your empire's ships to where they are going." },
    { key: 'travelVectorsPrivate', label: 'Travel Vectors (Private)', hint: 'Lines from private ships (freighters, passenger liners, miners of private companies) to where they are going.' },
    { key: 'potentialColonies', label: 'Potential Colonies', hint: 'Rings the planets you could colonise. Zoom into a system to see them.' },
    { key: 'scenicLocations', label: 'Scenic Locations', hint: 'Rings the scenic places that resort bases can be built at. Zoom into a system to see them.' },
    { key: 'researchLocations', label: 'Research Locations', hint: 'Rings the places that research stations can study. Zoom into a system to see them.' },
    { key: 'longRangeScanners', label: 'Long Range Scanners', hint: 'How far your long range scanners can see.' },
    { key: 'empireTerritory', label: 'Empire Territory', hint: 'Shades the space each empire holds in its colour.' },
    { key: 'factionMarkers', label: 'Faction markers', hint: 'Empire-coloured symbols for ships, bases and fleets, rings around owned systems, and the lines between them.', mod: true },
    { key: 'stationPresence', label: 'Station presence', hint: 'A disc in the colour of each empire around the systems where it has bases or colonies; larger with more of them.', mod: true },
    { key: 'fadeCivilianShips', label: 'Fade civilian ships and bases', hint: 'Draws the ships and bases of private companies fainter, so your own ships stand out.' },
    // [freightOverlay] begin
    { key: 'freightFlows', label: 'Freight Flows', hint: 'The busiest trade routes between the systems you have explored, coloured by cargo. Click a cargo in the legend to show only it, or one of its resources.', mod: true, panel: 'tradeFlows' },
    { key: 'tradeHubs', label: 'Trade Hubs', hint: 'Marks the space ports with the most trade income this year, in the systems you have explored.', mod: true, panel: 'tradeFlows' },
    // [freightOverlay] end
    { key: 'threats', label: 'Threats', hint: 'Marks the monsters, pirates and other threats you know of. A dashed or flickering mark is only suspected.' },
    { key: 'wrecks', label: 'Wreck Fields', hint: 'Marks the wreck fields left by battles, which can be salvaged.', mod: true },
    { key: 'vipTraffic', label: 'VIP traffic', hint: 'Lines from each VIP shuttle to where it is going.', mod: true },
    { key: 'colonyDesignations', label: 'Colony Designations', hint: 'A badge on each of your colonies showing what it is designated for.', mod: true },
    // Improvements section (ui/improvements.ts): rows with `improvement: '<id>'` go here.
    // [dw2overlays] begin
    { key: 'colonyScores', label: 'Colony Target Scores', hint: 'Rings the planets your Expansion Planner wants to colonise, coloured by how good each one is (green is best). Zoomed out, each system shows its best target.', improvement: 'colonyTargetScores' },
    { key: 'resources', label: 'Resources', hint: 'The resources you know of in each system and on each planet.', improvement: 'resourcesOverlay', panel: 'resources' },
    { key: 'fuelRange', label: 'Fuel Range', hint: 'How far the selected ship or fleet can go on its fuel, and where it can refuel.', improvement: 'fuelRangeOverlay' },
    // [dw2overlays] end
    { key: 'supplyShortages', label: 'Supply Shortages', hint: 'Marks your shipyards waiting for resources and your colonies short of luxuries.', improvement: 'supplyChain', panel: 'supplyShortages' },
    { key: 'waypoints', label: 'Waypoints & Known Locations', hint: 'Your own map pins (right-click empty space to add one) and the places you have learned of.', improvement: 'waypoints', panel: 'waypoints' },
];

// Waypoints (ui/waypoints.ts): named map pins of the player's own, and the locations the player knows of.
registerImprovement({
    id: 'waypoints',
    label: 'Waypoints & known locations',
    description: 'Name places on the map (right-click empty space, or W at the cursor) and see the locations you were told of or found.',
    default: true,
});

// [dw2overlays] begin — the three overlay improvements (on by default; each overlay's own toggle still starts off).
registerImprovement({
    id: 'colonyTargetScores',
    label: 'Colony target scores overlay',
    description: "Map overlay: the Expansion Planner's colonization targets, ringed in a colour from their score (green = best).",
    default: true,
});
registerImprovement({
    id: 'resourcesOverlay',
    label: 'Resources overlay',
    description: 'Map overlay: the resources you know of in each system, with rarity and abundance; pick one to find it.',
    default: true,
});
registerImprovement({
    id: 'fuelRangeOverlay',
    label: 'Fuel range overlay',
    description: "Map overlay: the selected ship's or fleet's reach on its fuel and the refuelling points it can use.",
    default: true,
});
// [dw2overlays] end

/** The overlay is on and, when it belongs to an improvement, that improvement is enabled (what the renderer draws). */
export function overlayActive(state: MapOverlayState, key: OverlayKey): boolean {
    if (!state[key]) return false;
    const row = OVERLAY_ROWS.find((r) => r.key === key);
    return row?.improvement === undefined || isImprovementEnabled(row.improvement);
}

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

// [dw2overlays] begin
/** The non-boolean overlay settings of one MapOverlayState (the "…" panels). */
export interface MapOverlayOptions {
    /** Resources overlay: the resource ids the player is looking for, sorted; empty = every known resource. UI-side only. */
    resourceFilter: readonly number[];
}

const NO_FILTER: readonly number[] = [];
const overlayOptions = new WeakMap<MapOverlayState, MapOverlayOptions>();

/** The options that go with `state` (created on first use: no filter). */
export function overlayOptionsOf(state: MapOverlayState): MapOverlayOptions {
    let o = overlayOptions.get(state);
    if (o === undefined) {
        o = { resourceFilter: NO_FILTER };
        overlayOptions.set(state, o);
    }
    return o;
}

/** Set the Resources overlay's selection (empty = all) and notify the subscribers, as a toggle does. The ids are kept
 * sorted and unique; the array is replaced on a change, so a renderer can compare it by identity. */
export function setOverlayResourceFilter(state: MapOverlayState, resourceIds: readonly number[]): void {
    const o = overlayOptionsOf(state);
    const next = [...new Set(resourceIds)].sort((a, b) => a - b);
    if (next.length === o.resourceFilter.length && next.every((id, i) => id === o.resourceFilter[i])) return;
    o.resourceFilter = next.length === 0 ? NO_FILTER : next;
    for (const fn of listeners) fn();
}

/** Turn one overlay flag on or off (no-op when it already is), notifying like toggleOverlay. */
export function setOverlay(state: MapOverlayState, key: OverlayKey, on: boolean): void {
    if (state[key] !== on) toggleOverlay(state, key);
}
// [dw2overlays] end
