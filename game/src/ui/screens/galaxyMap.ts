// Galaxy Map screen (task C3), opened with G or the HUD "Galaxy map (G)" row.
//
// Map rendering is a port of DistantWorlds/Controls/GalaxyMap.cs (method_6
// OnPaint: backdrop, nebulae, sector grid with A.. / 1.. labels, systems
// coloured by star type, selected systems in yellow, crosshair on the
// selected system) and the screen logic from Main.Part11.cs method_131
// (open), method_132 (close), gmapMain_MouseUp (select the nearest system),
// gmapMain_MouseDoubleClick / btnGalaxyMapGoto_Click (jump the Main View and
// close), and Main.Part9.cs cmbGalaxyMapViewMode_SelectedValueChanged (the
// 11 view modes / filters).
//
// The chrome is the original's pnlGalaxyMap ScreenPanel (945 x 760, Main.Part11.cs method_131 positions; the shared
// toolkit in ui/originalWindow.ts): the View / habitat type combos, Map Key and Go to selected item buttons and
// Back / Forward in the body's top row, the 650 x 650 map at (10, 40) and, in the right-hand column, picSystemMap,
// pnlHabitatInfo and pnlGalaxyMapHabitatPicture. pnlGalaxyMapKey is a 300 x 418 BorderPanel over it
// (method_129). Recreation additions keep the same style: the Nebulae / Region names toggles in the header and the
// match list (a column that widens the window while a view filter is active).

import { drawGalaxyMapMarkers } from '../waypoints'; // [waypoints]
import type { Galaxy } from '../../sim/galaxy';
import type { Empire } from '../../sim/empire';
import { DiplomaticRelationType } from '../../sim/diplomacy';
import { GalaxyLocationType } from '../../sim/galaxyLocation';
import { HabitatCategoryType, HabitatType, type Habitat } from '../../sim/types';
import { fogOf } from '../../render/fog';
import { drawGalaxyMapLayers } from './galaxyMapLayers';
import { landscapeImageUrl } from '../landscapeImages';
import { SystemVisibilityStatus } from '../../sim/visibility';
import { drawSystemView, findNearestHabitatNear, systemViewWorldAt } from '../systemView';
import { territoryColorFn } from '../../render/empireLayer';
import { drawTerritoryOnMap } from '../../render/territoryRaster';
import './galaxyMap.css';
import {
    COLORS,
    FONT,
    OwGrid,
    checkBox,
    dropDown,
    glassButton,
    gradientPanel,
    openOriginalWindow,
    place,
    setText,
    text as owText,
    type OriginalWindow,
} from '../originalWindow';
import { countLabel } from '../plural';
import { sectorColumnName } from '../../sim/sectorNames';

// ---------------------------------------------------------------------------
// Pure helpers (tested)
// ---------------------------------------------------------------------------

// Main.Part13.cs 199-201 / Main.Part12.cs 2295-2296: pen_1 (grid + labels)
// and pen_2 (selection crosshair) colours.
export const GRID_COLOR = 'rgb(32, 32, 88)';
export const CROSSHAIR_COLOR = 'rgb(96, 96, 255)';
// GalaxyMap.cs method_6: unselected systems while a filter/selection is active.
export const DIMMED_COLOR = 'rgb(80, 80, 80)';
export const SELECTED_COLOR = 'rgb(255, 255, 0)'; // Color.Yellow

// Port of GalaxyMap.cs method_4 with the brushes from Main.Part13.cs 249-256.
export function starBrushColor(h: Habitat): string | null {
    if (h.category === HabitatCategoryType.Star) {
        switch (h.type) {
            case HabitatType.MainSequence:
                return 'rgb(255, 255, 0)'; // solidBrush_17 Yellow
            case HabitatType.RedGiant:
            case HabitatType.SuperGiant:
                return 'rgb(255, 0, 0)'; // solidBrush_18/19 Red
            case HabitatType.WhiteDwarf:
                return 'rgb(255, 255, 255)'; // solidBrush_20 White
            case HabitatType.Neutron:
                return 'rgb(0, 255, 255)'; // solidBrush_21 Aqua
            case HabitatType.BlackHole:
                return 'rgb(0, 0, 176)'; // solidBrush_23
            case HabitatType.SuperNova:
                return 'rgb(128, 0, 128)'; // solidBrush_22 Purple
        }
        return null;
    }
    if (h.category === HabitatCategoryType.GasCloud) {
        return 'rgb(238, 130, 238)'; // solidBrush_24 Violet
    }
    return null;
}

// GalaxyMap.cs method_6: dot sizes num28 (normal) / num29 (selected).
export function starDotSizes(mapWidthPx: number, hasSelection: boolean, starViewMode = 0): { normal: number; selected: number } {
    if (mapWidthPx >= 400 && (hasSelection || starViewMode > 0)) {
        return { normal: 3, selected: 5 };
    }
    return { normal: 2, selected: 5 };
}

// GalaxyMap.cs Ignite: double_4 = Galaxy.SizeX / ClientRectangle.Width (world
// units per map pixel; the same factor is used for y). Custom size (not a port): the maps are square and the C# galaxy
// is too; a non-square galaxy is fitted by its longer side (= SizeX when square), so the whole galaxy stays on the map.
export function galaxyMapScale(galaxy: Galaxy, mapWidthPx: number): number {
    return Math.max(galaxy.sizeX, galaxy.sizeY) / mapWidthPx;
}

/**
 * The small GalaxyMap control the screens embed (gmapEmpireDetail, gmapColony …) after SetSystem / SetSystems:
 * black, every system as a dot in its star colour — dimmed grey once some are selected — and the selected systems
 * in yellow (GalaxyMap.cs method_6). `w` is the control's width in original pixels; the canvas is rasterised at
 * the device pixel ratio × 2 so it stays crisp inside a scaled original-style window.
 */
/** GalaxyMap.cs 141-157: the empire territory bitmap under the dots at 40% (TransparentImage(0.4)), over the whole
 * galaxy on a `mapW` px map. Cached and shared with the Main View (render/territoryRaster.ts): not recomputed per open
 * unless the territory changed. Shared by the Galaxy Map window and the mini maps. */
export function drawMapTerritory(ctx: CanvasRenderingContext2D, galaxy: Galaxy, mapW: number): void {
    drawTerritoryOnMap(ctx, galaxy, fogOf(galaxy).player, territoryColorFn(galaxy), mapW, 0.4);
}

export function drawSystemsMiniMap(canvas: HTMLCanvasElement, galaxy: Galaxy, w: number, selected: ReadonlySet<Habitat>): void {
    const dpr = Math.min(3, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1) * 2;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(w * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, w);
    const s = galaxyMapScale(galaxy, w);
    // GalaxyMap.cs method_6: bitmap_1 (backdrop) and bitmap_0 (nebulae) under the territory (galaxyMapLayers.ts); the
    // control redraws itself while the shared nebula composite fills in.
    drawGalaxyMapLayers(ctx, galaxy, s, 0, 0, { onChange: () => { if (canvas.isConnected) drawSystemsMiniMap(canvas, galaxy, w, selected); } });
    drawMapTerritory(ctx, galaxy, w);
    const filter = selected.size > 0;
    const sizes = starDotSizes(w, filter);
    const dot = (h: Habitat, color: string | null, size: number): void => {
        if (color === null) return;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(h.xpos / s, h.ypos / s, size / 2, size / 2, 0, 0, Math.PI * 2);
        ctx.fill();
    };
    for (const sys of galaxy.systems) dot(sys.systemStar, filter ? DIMMED_COLOR : starBrushColor(sys.systemStar), sizes.normal);
    for (const h of selected) dot(h, SELECTED_COLOR, sizes.selected);
}

// Sector-grid label for column i (GalaxyMap.cs: (char)(i + 65)) and row j (j + 1).
// Past Z (custom sizes only) the columns go AA, AB, … (sectorNames.ts).
export function sectorColumnLabel(i: number): string {
    return sectorColumnName(i);
}

/**
 * Custom galaxy size (not a port): label every n-th sector column / row once a big custom galaxy makes the cells too
 * small for a label each (the C# draws every label; its galaxies have at most 15 sectors a side, which always get 1).
 */
export function sectorLabelStride(count: number, cellPx: number): number {
    if (count <= 15) return 1;
    return Math.max(1, Math.ceil(16 / Math.max(cellPx, 1e-6)));
}

// Main.Part3.cs 1036-1049: the View combo (cmbGalaxyMapViewMode).
export enum GalaxyMapViewMode {
    Default,
    OurSystems,
    PotentialColonies,
    KnownResources,
    ExploredSystems,
    IndependentPopulations,
    EnemySystems,
    PirateBases,
    AncientRuins,
    ScenicLocations,
    ResearchLocations,
}

export const VIEW_MODE_LABELS: readonly string[] = [
    '(Default)',
    'Our Systems',
    'Potential Colonies',
    'Known Resources',
    'Explored Systems',
    'Independent Populations',
    'Enemy Systems',
    'Pirate Bases',
    'Ancient Ruins',
    'Scenic Locations',
    'Research Locations',
];

// Main.Part12.cs 2355-2361: the Potential Colonies habitat-type combo.
export const COLONY_TYPE_FILTERS: readonly { label: string; type: HabitatType }[] = [
    { label: '(All Types)', type: HabitatType.Undefined },
    { label: 'Continental', type: HabitatType.Continental },
    { label: 'Marshy Swamp', type: HabitatType.MarshySwamp },
    { label: 'Desert', type: HabitatType.Desert },
    { label: 'Ocean', type: HabitatType.Ocean },
    { label: 'Ice', type: HabitatType.Ice },
    { label: 'Volcanic', type: HabitatType.Volcanic },
];

// What the filters need from the player's empire. In games with a player
// empire, `empireGalaxyMapPlayer` below provides it; `GOD_MODE_PLAYER` (everything
// explored and surveyed, empire-only lists empty) is used only on the
// generateGalaxy-only boot where no empires exist.
export interface GalaxyMapPlayer {
    // C#: PlayerEmpire.CheckSystemVisibilityStatus(i) is Visible or Explored.
    systemExplored(systemIndex: number): boolean;
    // C#: PlayerEmpire.ResourceMap.CheckResourcesKnown(h).
    resourcesKnown(h: Habitat): boolean;
    // C#: PlayerEmpire.Colonies.
    colonies(): readonly Habitat[];
    // C#: IdentifyColonizationTargets(galaxy, false, 0, 500) habitats, in order.
    colonizationTargets(): readonly Habitat[];
    // C#: colonies of empires at War with the player.
    enemyColonies(): readonly Habitat[];
    // C#: PlayerEmpire.KnownPirateBases[i].ParentHabitat.
    knownPirateBaseHabitats(): readonly Habitat[];
}

export const GOD_MODE_PLAYER: GalaxyMapPlayer = {
    systemExplored: () => true,
    resourcesKnown: () => true,
    colonies: () => [],
    colonizationTargets: () => [],
    enemyColonies: () => [],
    knownPirateBaseHabitats: () => [],
};

// Task 13e: the Galaxy Map's view of the real player empire (Main.Part9.cs
// cmbGalaxyMapViewMode_SelectedValueChanged reads these off PlayerEmpire).
export function empireGalaxyMapPlayer(empire: Empire): GalaxyMapPlayer {
    return {
        // checkSystemExplored indexes systemVisibility without a bounds check; guard here.
        systemExplored: (i) => i >= 0 && i < empire.visibility.systemVisibility.length && empire.visibility.checkSystemExplored(i),
        resourcesKnown: (h) => empire.resourceMap.checkResourcesKnown(h),
        colonies: () => empire.colonies,
        // TODO(port): Empire.IdentifyColonizationTargets(galaxy, false, 0, 500) — not in sim.
        colonizationTargets: () => [],
        enemyColonies: (): readonly Habitat[] => {
            const out: Habitat[] = [];
            for (const rel of empire.diplomaticRelations) {
                if (rel.type !== DiplomaticRelationType.War) continue;
                if (rel.otherEmpire === null || rel.otherEmpire === empire) continue;
                for (const c of rel.otherEmpire.colonies) out.push(c);
            }
            return out;
        },
        knownPirateBaseHabitats: (): readonly Habitat[] => {
            // The sim does not fill knownPirateBases yet (TODO(port) in
            // empire.ts), so this is empty for now.
            const out: Habitat[] = [];
            for (const b of empire.knownPirateBases) {
                if (b.parentHabitat !== null) out.push(b.parentHabitat);
            }
            return out;
        },
    };
}

export interface ViewModeSelection {
    /** C# habitatList_1: system stars highlighted on the map (null = no filter). */
    systems: Habitat[] | null;
    /** C# habitatList_2: the individual habitats (for the side list). */
    habitats: Habitat[] | null;
}

// Port of Main.Part9.cs cmbGalaxyMapViewMode_SelectedValueChanged (3663).
export function computeViewModeSelection(
    galaxy: Galaxy,
    mode: GalaxyMapViewMode,
    player: GalaxyMapPlayer = GOD_MODE_PLAYER,
    opts: { habitatType?: HabitatType; resourceId?: number | null } = {},
): ViewModeSelection {
    const systems: Habitat[] = [];
    const habitats: Habitat[] = [];
    const addStar = (h: Habitat): void => {
        const star = galaxy.determineHabitatSystemStar(h);
        if (star !== null && !systems.includes(star)) systems.push(star);
    };
    const explored = (h: Habitat): boolean => h.category === HabitatCategoryType.GasCloud || player.systemExplored(h.systemIndex);
    switch (mode) {
        case GalaxyMapViewMode.Default:
            return { systems: null, habitats: null };
        case GalaxyMapViewMode.OurSystems:
            for (const c of player.colonies()) addStar(c);
            return { systems, habitats: [...player.colonies()] };
        case GalaxyMapViewMode.PotentialColonies: {
            const t = opts.habitatType ?? HabitatType.Undefined;
            for (const h of player.colonizationTargets()) {
                if (t === HabitatType.Undefined || t === h.type) {
                    habitats.push(h);
                    addStar(h);
                }
            }
            return { systems, habitats };
        }
        case GalaxyMapViewMode.KnownResources: {
            const id = opts.resourceId;
            if (id === undefined || id === null) return { systems: null, habitats: null };
            for (const h of galaxy.habitats) {
                if (!player.resourcesKnown(h)) continue;
                if (h.resources.some((r) => r.resourceId === id)) {
                    habitats.push(h);
                    addStar(h);
                }
            }
            return { systems, habitats };
        }
        case GalaxyMapViewMode.ExploredSystems:
            for (const h of galaxy.habitats) {
                if (explored(h)) {
                    addStar(h);
                    if (player.resourcesKnown(h)) habitats.push(h);
                }
            }
            return { systems, habitats };
        case GalaxyMapViewMode.IndependentPopulations:
            // C#: Population > 0 and (Empire == IndependentEmpire || Empire == null).
            for (const h of galaxy.habitats) {
                if (h.population.totalAmount <= 0 || (h.empire !== galaxy.independentEmpire && h.empire !== null)) continue;
                if (explored(h)) {
                    addStar(h);
                    habitats.push(h);
                }
            }
            return { systems, habitats };
        case GalaxyMapViewMode.EnemySystems:
            for (const c of player.enemyColonies()) {
                const star = galaxy.determineHabitatSystemStar(c);
                if (player.systemExplored(star.systemIndex)) {
                    addStar(c);
                    habitats.push(c);
                }
            }
            return { systems, habitats };
        case GalaxyMapViewMode.PirateBases:
            for (const h of player.knownPirateBaseHabitats()) {
                addStar(h);
                habitats.push(h);
            }
            return { systems, habitats };
        case GalaxyMapViewMode.AncientRuins:
            // TODO(port): Habitat.Ruin (not modelled yet) — always empty.
            return { systems, habitats };
        case GalaxyMapViewMode.ScenicLocations:
            for (const h of galaxy.habitats) {
                if (h.scenicFactor > 0 && explored(h)) {
                    addStar(h);
                    habitats.push(h);
                }
            }
            return { systems, habitats };
        case GalaxyMapViewMode.ResearchLocations:
            for (const h of galaxy.habitats) {
                if (h.researchBonus > 0 && explored(h)) {
                    addStar(h);
                    habitats.push(h);
                }
            }
            return { systems, habitats };
    }
    return { systems: null, habitats: null };
}

// Port of Galaxy.6.cs FindNearestSystemGasCloudAsteroid as used by
// gmapMain_MouseUp: the nearest top-level habitat (system star, gas cloud or
// asteroid field) to a world point.
export function findNearestSystemAt(galaxy: Galaxy, x: number, y: number): Habitat | null {
    let best: Habitat | null = null;
    let bestD = Number.MAX_VALUE;
    for (const h of galaxy.habitats) {
        if (h.parent !== null) continue;
        const dx = h.xpos - x;
        const dy = h.ypos - y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
            bestD = d;
            best = h;
        }
    }
    return best;
}

// Map pixel <-> world for a square map of `mapPx` pixels (GalaxyMap.cs: the
// map always shows the whole galaxy, so int_8/int_10 are 0).
export function mapToWorld(galaxy: Galaxy, mapPx: number, px: number, py: number): { x: number; y: number } {
    const s = galaxyMapScale(galaxy, mapPx);
    return { x: Math.trunc(px * s), y: Math.trunc(py * s) };
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export interface GalaxyMapViewRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface GalaxyMapOptions {
    galaxy: Galaxy;
    /** World rectangle currently shown by the Main View. */
    getViewRect: () => GalaxyMapViewRect;
    /** Jump the Main View to a world point (C# method_157 / method_149). */
    jumpTo: (x: number, y: number) => void;
    player?: GalaxyMapPlayer;
    /** Galaxy-time pause while the popup is open (C# AutoPauseWhenInPopupWindow). */
    onOpen?: () => void;
    onClose?: () => void;
    /** pnlHabitatInfo (Main.Part10.cs 1799 method_214 → InfoPanel.SetData(habitat_8), 250 × 240 at (670, 267)): draw the
     *  selected habitat's InfoPanel into `box` (main.ts: selectionInfo habitatInfo + renderInfoModel). Without it the
     *  map shows a short text summary. */
    renderHabitatInfo?: (box: HTMLElement, h: Habitat) => void;
}

export interface GalaxyMapScreen {
    readonly element: HTMLElement;
    readonly isOpen: boolean;
    /** Close, remove the element and drop the window resize listener. */
    destroy(): void;
    open(selected?: Habitat | null): void;
    close(): void;
    toggle(selected?: Habitat | null): void;
    setViewMode(mode: GalaxyMapViewMode): void;
    /** Select the nearest system to a world point (as a single click does). */
    selectAt(x: number, y: number): Habitat | null;
    /** habitat_8 / habitat_7: the selected habitat and the system the system map shows. */
    readonly selectedHabitat: Habitat | null;
    readonly selectedSystem: Habitat | null;
    /** btnGalaxyMapBack / btnGalaxyMapForward. */
    back(): void;
    forward(): void;
    /** Redraw the map (when open): the waypoint overlay changed (ui/waypoints.ts). */
    redraw(): void;
}

// ---------------------------------------------------------------------------
// Back / Forward (Main.Part10.cs method_213 / btnGalaxyMapBack_Click / btnGalaxyMapForward_Click / method_215)
// ---------------------------------------------------------------------------

/** Main.Part13.cs 171: dremNtuMsv, the most habitats the Galaxy Map's Back / Forward history keeps. */
export const GALAXY_MAP_HISTORY_MAX = 100;

/** habitatList_0 + int_24: the visited habitats and the current position. */
export interface GalaxyMapHistory {
    list: Habitat[];
    index: number;
}

export function createGalaxyMapHistory(): GalaxyMapHistory {
    return { list: [], index: 0 };
}

/** Port of Main.Part10.cs method_213: record a visit (no-op when it is the current entry). Visiting from an earlier
 * position drops the entries after it; a full list shifts its oldest entry out. */
export function galaxyMapHistoryPush(hist: GalaxyMapHistory, h: Habitat, max = GALAXY_MAP_HISTORY_MAX): void {
    const list = hist.list;
    if (list.length > 0 && list[hist.index] === h) return;
    if (hist.index < list.length - 1) {
        hist.index++;
        list[hist.index] = h;
        if (hist.index < list.length - 1) list.splice(hist.index + 1, list.length - (hist.index + 1));
    } else if (list.length >= max) {
        for (let i = 0; i < list.length - 1; i++) list[i] = list[i + 1];
        list[list.length - 1] = h;
        hist.index = list.length - 1;
    } else {
        list.push(h);
        hist.index = list.length - 1;
    }
}

/** btnGalaxyMapBack_Click: step back; returns the habitat to show (method_214) or null. */
export function galaxyMapHistoryBack(hist: GalaxyMapHistory): Habitat | null {
    if (hist.index > 0) {
        hist.index--;
        return hist.list[hist.index];
    }
    return null;
}

/** btnGalaxyMapForward_Click: step forward; returns the habitat to show or null. */
export function galaxyMapHistoryForward(hist: GalaxyMapHistory): Habitat | null {
    if (hist.index < hist.list.length - 1) {
        hist.index++;
        return hist.list[hist.index];
    }
    return null;
}

/** method_215: the Back / Forward buttons' Enabled states. */
export function galaxyMapHistoryButtons(hist: GalaxyMapHistory): { back: boolean; forward: boolean } {
    return { back: hist.index > 0, forward: hist.index < hist.list.length - 1 };
}

/** method_132 (close): habitatList_0.Clear(); int_24 = 0. */
export function galaxyMapHistoryClear(hist: GalaxyMapHistory): void {
    hist.list.length = 0;
    hist.index = 0;
}

/** Main.Part11.cs method_152: the system (habitat_7) and habitat (habitat_8) shown for a selected habitat — a moon's
 * planet's star, a planet's / asteroid field's star, or the star / gas cloud itself. */
export function galaxyMapSystemOf(galaxy: Galaxy, h: Habitat): Habitat {
    switch (h.category) {
        case HabitatCategoryType.Moon:
            return h.parent?.parent ?? galaxy.determineHabitatSystemStar(h);
        case HabitatCategoryType.Planet:
        case HabitatCategoryType.Asteroid:
            return h.parent ?? h;
    }
    return h;
}

/** Main.Part11.cs 1078: picSystemMap 250 × 250; scaleFactor = Galaxy.MaxSolarSystemSize * 2 / width (int). */
export const SYSTEM_MAP_PX = 250;
export function galaxyMapSystemScale(galaxy: Galaxy, width = SYSTEM_MAP_PX): number {
    return Math.trunc((galaxy.maxSolarSystemSize * 2) / width);
}
/** pnlGalaxyMapHabitatPicture 250 × 174 at (670, 516), BackColor (32, 32, 48), ImageLayout.Center. */
export const LANDSCAPE_PICTURE = { w: 250, h: 174 } as const;
/** Main.Part11.cs 1043: gmapMain.Size 650 × 650. */
export const MAP_PX = 650;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

const STAR_TYPE_NAMES: Partial<Record<HabitatType, string>> = {
    [HabitatType.MainSequence]: 'Main Sequence Star',
    [HabitatType.RedGiant]: 'Red Giant',
    [HabitatType.SuperGiant]: 'Super Giant',
    [HabitatType.WhiteDwarf]: 'White Dwarf',
    [HabitatType.Neutron]: 'Neutron Star',
    [HabitatType.BlackHole]: 'Black Hole',
    [HabitatType.SuperNova]: 'Super Nova',
};

export function createGalaxyMap(opts: GalaxyMapOptions): GalaxyMapScreen {
    const { galaxy } = opts;
    // Task 13e: the real player empire when there is one; god mode only on the
    // generateGalaxy-only boot (no empires).
    const player = opts.player ?? (galaxy.playerEmpire !== null ? empireGalaxyMapPlayer(galaxy.playerEmpire) : GOD_MODE_PLAYER);
    let isOpen = false;
    let mode = GalaxyMapViewMode.Default;
    let colonyType = HabitatType.Undefined;
    let resourceId: number | null = null;
    let selection: ViewModeSelection = { systems: null, habitats: null };
    // C# habitat_7 (the shown system) and habitat_8 (the selected habitat in it).
    let selectedSystem: Habitat | null = null;
    let selectedHabitat: Habitat | null = null;
    // habitatList_0 / int_24: the Back / Forward history.
    const history = createGalaxyMapHistory();
    let showNebulae = true;
    let showRegions = true;

    // The screen's element stays an inert host (main.ts appends it); the window is opened per open() (originalWindow.ts).
    const root = el('div', 'gmap-host');
    root.hidden = true;
    let win: OriginalWindow | null = null;
    let keyWin: OriginalWindow | null = null;

    // Body-relative positions: Main.Part11.cs method_131 (the ScreenPanel reparents its controls into the body).
    const WIN_W = 945;
    const WIN_H = 760;
    const LIST_W = 240;
    let listShown = false;
    const setShown = (e: HTMLElement, shown: boolean): void => {
        e.style.display = shown ? '' : 'none';
    };

    const mapWrap = place(el('div', 'gmap-map'), 10, 40, MAP_PX, MAP_PX);
    const canvas = el('canvas', 'gmap-canvas');
    mapWrap.appendChild(canvas);

    // lblGalaxyMapViewModeLabel (10, 10) + cmbGalaxyMapViewMode (65, 8, 130 x 20).
    const viewLabel = place(owText('View', { bold: true, color: COLORS.label }), 10, 10);
    const viewSel = place(
        dropDown(
            VIEW_MODE_LABELS.map((label, i) => ({ value: String(i), label })),
            String(mode),
            (v) => {
                mode = Number(v) as GalaxyMapViewMode;
                recompute();
            },
        ),
        65,
        8,
        130,
        20,
    );
    // cmbGalaxyMapHabitatType / the resource combo (omjYcxcvXH), both at (205, 8, 115 x 20).
    const typeSel = place(
        dropDown(
            COLONY_TYPE_FILTERS.map((f, i) => ({ value: String(i), label: f.label })),
            '0',
            (v) => {
                colonyType = COLONY_TYPE_FILTERS[Number(v)].type;
                recompute();
            },
        ),
        205,
        8,
        115,
        20,
    );
    // Main.Part12.cs 2340-2353: resources sorted by name.
    const resources = [...galaxy.resources].sort((a, b) => a.name.localeCompare(b.name));
    const resSel = place(
        dropDown(
            resources.map((r) => ({ value: String(r.resourceId), label: r.name })),
            resources.length > 0 ? String(resources[0].resourceId) : '',
            (v) => {
                resourceId = Number(v);
                recompute();
            },
        ),
        205,
        8,
        115,
        20,
    );

    // btnGalaxyMapKey (330, 8, 75 x 25), btnGalaxyMapGoto (410, 8, 140 x 25).
    const keyBtn = place(glassButton('Map Key', { size: FONT.small, onClick: () => toggleKey() }), 330, 8, 75, 25);
    const gotoBtn = place(
        glassButton('Go to selected item', {
            size: FONT.tiny,
            onClick: () => {
                const h = selectedHabitat ?? selectedSystem;
                if (h !== null) jump(h);
            },
        }),
        410,
        8,
        140,
        25,
    );

    // btnGalaxyMapBack (575, 6) / btnGalaxyMapForward (620, 6), 40 x 30.
    const backBtn = place(glassButton('', { image: 'back.png', title: 'Back' }), 575, 6, 40, 30);
    backBtn.dataset.gmap = 'back';
    const fwdBtn = place(glassButton('', { image: 'forward.png', title: 'Forward' }), 620, 6, 40, 30);
    fwdBtn.dataset.gmap = 'forward';

    // Recreation additions (header-parented, like the other screens' filters): the map layer toggles.
    const nebulaToggle = place(checkBox('Nebulae', showNebulae, (v) => { showNebulae = v; draw(); }), 330, 15);
    const regionToggle = place(checkBox('Region names', showRegions, (v) => { showRegions = v; draw(); }), 440, 15);

    // picSystemMap (670, 8, 250 x 250), pnlHabitatInfo (670, 267, 250 x 240), pnlGalaxyMapHabitatPicture (670, 516).
    const sysCanvas = place(el('canvas', 'gmap-system-map'), 670, 8, SYSTEM_MAP_PX, SYSTEM_MAP_PX);
    sysCanvas.title = 'Click a planet or moon to select it. Double-click to go there.';
    const info = place(el('div', 'gmap-info'), 670, 267, 250, 240);
    const landscape = place(el('div', 'gmap-landscape'), 670, 516, LANDSCAPE_PICTURE.w, LANDSCAPE_PICTURE.h);

    // The match list (the recreation's lvwHabitats): its own column to the right of the picture column.
    const listPanel = place(gradientPanel({ corners: { tr: true, br: true }, className: 'gmap-list-panel' }), 930, 40, LIST_W - 10, MAP_PX);
    const listHead = place(owText('', { color: COLORS.label }), 935, 10);
    const listGrid = new OwGrid<Habitat>({
        columns: [{ id: 'name', header: 'Name', render: (h, c) => { c.textContent = h.name; } }],
        key: (h) => h,
        headers: false,
        fontSize: FONT.small,
        // lvwHabitats_SelectedIndexChanged: habitat_7 = its system, habitat_8 = the habitat.
        onSelect: (h) => showHabitat(galaxyMapSystemOf(galaxy, h), h, true),
        onDoubleClick: (h) => jump(h),
    });
    place(listGrid.el, 0, 0, LIST_W - 14, MAP_PX - 4);
    listPanel.appendChild(listGrid.el);

    /** Fill the opened window's body / header with the screen's controls. */
    const mount = (w: OriginalWindow): void => {
        w.body.append(mapWrap, viewLabel, viewSel, typeSel, resSel, keyBtn, gotoBtn, backBtn, fwdBtn, sysCanvas, info, landscape, listHead, listPanel);
        w.header?.append(nebulaToggle, regionToggle);
    };

    const mapPx = MAP_PX;

    const updateFilterVisibility = (): void => {
        setShown(typeSel, mode === GalaxyMapViewMode.PotentialColonies);
        setShown(resSel, mode === GalaxyMapViewMode.KnownResources);
    };

    const recompute = (): void => {
        selection = computeViewModeSelection(galaxy, mode, player, { habitatType: colonyType, resourceId });
        updateFilterVisibility();
        renderList();
        draw();
        drawSystemMap();
    };

    const renderInfo = (): void => {
        info.replaceChildren();
        const sys = selectedSystem;
        const h = selectedHabitat ?? sys;
        if (sys === null || h === null) {
            info.append(el('div', 'gmap-muted gmap-hint', 'Click a system to select it. Double-click to go there.'));
            gotoBtn.disabled = true;
            return;
        }
        gotoBtn.disabled = false;
        if (opts.renderHabitatInfo !== undefined) {
            const box = el('div', 'sel-content-box gmap-habitat-info');
            info.appendChild(box);
            opts.renderHabitatInfo(box, h);
            return;
        }
        info.append(el('div', 'gmap-sel-name', h.name));
        const sx = Math.trunc(h.xpos / galaxy.sectorSize);
        const sy = Math.trunc(h.ypos / galaxy.sectorSize);
        if (h !== sys) {
            const known = player.systemExplored(h.systemIndex);
            info.append(el('div', 'gmap-muted', `${known ? habitatTypeWords(h) : 'Unexplored'} · ${sys.name} system · Sector ${sectorColumnLabel(sx)}${sy + 1}`));
            if (known && h.empire !== null && h.empire !== galaxy.independentEmpire) info.append(el('div', 'gmap-muted', h.empire.name));
            return;
        }
        const typeName = h.category === HabitatCategoryType.GasCloud ? 'Gas Cloud' : STAR_TYPE_NAMES[h.type] ?? 'System';
        info.append(el('div', 'gmap-muted', `${typeName} · Sector ${sectorColumnLabel(sx)}${sy + 1}`));
        if (h.category === HabitatCategoryType.Star) {
            const hs = galaxy.systemHabitatsOf(h.systemIndex);
            const planets = hs.filter((x) => x.category === HabitatCategoryType.Planet).length;
            const moons = hs.filter((x) => x.category === HabitatCategoryType.Moon).length;
            const pops = hs.filter((x) => x.population.totalAmount > 0).length;
            info.append(el('div', 'gmap-muted', `${countLabel(planets, 'planet')} · ${countLabel(moons, 'moon')}${pops > 0 ? ` · ${pops} populated` : ''}`));
        }
    };

    // pnlGalaxyMapHabitatPicture: bitmap_29[habitat_8.LandscapePictureRef], centred, else empty.
    let landscapeUrl: string | null = null;
    const renderLandscape = (): void => {
        const h = selectedHabitat;
        const url = h !== null && player.systemExplored(h.systemIndex) ? landscapeImageUrl(h.landscapePictureRef) : null;
        if (url === landscapeUrl) return;
        landscapeUrl = url;
        landscape.style.backgroundImage = url === null ? '' : `url("${url}")`;
    };

    const renderNav = (): void => {
        const b = galaxyMapHistoryButtons(history);
        backBtn.disabled = !b.back;
        fwdBtn.disabled = !b.forward;
    };

    const renderList = (): void => {
        const hs = selection.habitats;
        setListColumn(hs !== null);
        if (hs === null) {
            listGrid.setRows([]);
            return;
        }
        setText(listHead, `${hs.length} ${hs.length === 1 ? 'match' : 'matches'} in ${countLabel(selection.systems?.length ?? 0, 'system')}`);
        listGrid.setRows(hs.slice(0, 200));
    };

    /** Widen the window by the list column while a view filter lists habitats. */
    const setListColumn = (show: boolean): void => {
        listShown = show;
        setShown(listHead, show);
        setShown(listPanel, show);
        if (win !== null) {
            win.setSize(show ? WIN_W + LIST_W : WIN_W, WIN_H);
            resizeCanvases();
        }
    };

    /** Back the canvases at the window's scale (the window is scaled as one with a CSS transform). */
    const resizeCanvases = (): void => {
        const k = Math.min(3, Math.max(1, (window.devicePixelRatio || 1) * (win?.scale ?? 1)));
        canvas.style.width = `${MAP_PX}px`;
        canvas.style.height = `${MAP_PX}px`;
        canvas.width = Math.round(MAP_PX * k);
        canvas.height = Math.round(MAP_PX * k);
        sysCanvas.width = Math.round(SYSTEM_MAP_PX * k);
        sysCanvas.height = Math.round(SYSTEM_MAP_PX * k);
        draw();
        drawSystemMap();
    };

    // Port of GalaxyMap.cs method_6 for the whole-galaxy case (int_8 = int_10 = 0).
    const draw = (): void => {
        if (!isOpen) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const dpr = canvas.width / mapPx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const s = galaxyMapScale(galaxy, mapPx); // double_5
        const W = mapPx;
        const H = mapPx;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        // Backdrop (bitmap_1 = galaxy_backdrop.jpg) stretched over the galaxy, then the nebulae (bitmap_0, when
        // bool_0 showNebulae) — the shared layers (galaxyMapLayers.ts).
        drawGalaxyMapLayers(ctx, galaxy, s, 0, 0, { nebulae: showNebulae, onChange: draw });
        // Empire territory (bitmap_0 territory, 40%).
        drawMapTerritory(ctx, galaxy, W);
        // Sector grid + labels (pen_1 / solidBrush_0, Verdana 7pt).
        const secPx = galaxy.sectorSize / s; // num21
        ctx.strokeStyle = GRID_COLOR;
        ctx.fillStyle = GRID_COLOR;
        ctx.lineWidth = 1;
        ctx.font = '9px Verdana, sans-serif';
        ctx.textBaseline = 'top';
        const cols = galaxy.sectorWidth;
        const rows = galaxy.sectorHeight;
        const gridBottom = Math.min(H, rows * secPx);
        const gridRight = Math.min(W, cols * secPx);
        ctx.beginPath();
        for (let i = 0; i <= cols; i++) {
            const x = Math.trunc(i * secPx) + 0.5;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, gridBottom);
        }
        for (let j = 0; j <= rows; j++) {
            const y = Math.trunc(j * secPx) + 0.5;
            ctx.moveTo(0, y);
            ctx.lineTo(gridRight, y);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgb(96, 96, 170)'; // labels a little brighter than the grid for legibility
        const colStep = sectorLabelStride(cols, secPx);
        const rowStep = sectorLabelStride(rows, secPx);
        for (let i = 0; i < cols; i += colStep) {
            ctx.fillText(sectorColumnLabel(i), Math.trunc(i * secPx + secPx / 2 - 3), 2);
        }
        for (let j = 0; j < rows; j += rowStep) {
            ctx.fillText(String(j + 1), 2, Math.trunc(j * secPx + secPx / 2 - 5));
        }
        // Region names (08f1 data: named GalaxyLocations).
        if (showRegions) {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (const loc of galaxy.galaxyLocations) {
                // Same rule as the Main View region labels (08f1): ShowName.
                if (!loc.showName || loc.name === '') continue;
                const c = loc.resolveLocationCenter();
                ctx.font = loc.type === GalaxyLocationType.NebulaCloud ? 'bold 11px "Forgotten Futurist", sans-serif' : '10px "Forgotten Futurist", sans-serif';
                ctx.fillStyle = loc.type === GalaxyLocationType.NebulaCloud ? 'rgba(200, 200, 230, 0.85)' : 'rgba(170, 170, 200, 0.7)';
                ctx.fillText(loc.name, c.x / s, c.y / s);
            }
            ctx.textAlign = 'start';
            ctx.textBaseline = 'top';
        }
        // Systems (method_6 main loop) + gas clouds (C# Systems include them).
        const filterActive = selection.systems !== null;
        const filterSet = filterActive ? new Set(selection.systems) : null;
        const sizes = starDotSizes(W, filterActive);
        const drawDot = (h: Habitat): void => {
            let color = starBrushColor(h);
            let size = sizes.normal;
            if (filterSet !== null) {
                color = DIMMED_COLOR;
                if (filterSet.has(h)) {
                    color = SELECTED_COLOR;
                    size = sizes.selected;
                }
            }
            if (color === null) return;
            const x = h.xpos / s;
            const y = h.ypos / s;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.ellipse(x, y, size / 2, size / 2, 0, 0, Math.PI * 2);
            ctx.fill();
        };
        // After C2 gas clouds are SystemInfo entries too; draw each once either way.
        const drawn = new Set<Habitat>();
        for (const sys of galaxy.systems) { drawn.add(sys.systemStar); drawDot(sys.systemStar); }
        for (const h of galaxy.habitats) if (h.category === HabitatCategoryType.GasCloud && h.parent === null && !drawn.has(h)) drawDot(h);
        // Selected systems on top so they are never hidden by dimmed ones.
        if (filterActive) for (const h of selection.systems!) drawDot(h);
        // [waypoints] the Waypoints & Known Locations overlay (an Improvement, ui/waypoints.ts), over the systems.
        drawGalaxyMapMarkers(ctx, galaxy, s);
        // Current Main View rectangle (pen_2).
        const vr = opts.getViewRect();
        ctx.strokeStyle = CROSSHAIR_COLOR;
        ctx.lineWidth = 1;
        const rx = vr.x / s;
        const ry = vr.y / s;
        const rw = Math.max(3, vr.width / s);
        const rh = Math.max(3, vr.height / s);
        ctx.strokeRect(Math.round(rx) + 0.5, Math.round(ry) + 0.5, Math.round(rw), Math.round(rh));
        // Crosshair on the selected system (SetPosition: double_0/double_1).
        if (selectedSystem !== null) {
            const cx = Math.trunc(selectedSystem.xpos / s) + 1 + 0.5;
            const cy = Math.trunc(selectedSystem.ypos / s) + 1 + 0.5;
            ctx.beginPath();
            ctx.moveTo(cx, 0);
            ctx.lineTo(cx, H);
            ctx.moveTo(0, cy);
            ctx.lineTo(W, cy);
            ctx.stroke();
        }
    };

    // picSystemMap.Ignite(relativeToView: false, the system's index, MaxSolarSystemSize * 2 / 250, showIndicatorLines,
    // habitat_7.Name) with SetSelectedHabitats(habitatList_2) — SystemView.cs method_5 (systemView.ts).
    const drawSystemMap = (): void => {
        if (!isOpen) return;
        const ctx = sysCanvas.getContext('2d');
        if (!ctx) return;
        const dpr = sysCanvas.width / SYSTEM_MAP_PX;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const sys = selectedSystem;
        if (sys === null) {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, SYSTEM_MAP_PX, SYSTEM_MAP_PX);
            return;
        }
        drawSystemView(ctx, {
            galaxy,
            player: player === GOD_MODE_PLAYER ? null : galaxy.playerEmpire,
            width: SYSTEM_MAP_PX,
            height: SYSTEM_MAP_PX,
            star: sys,
            scale: galaxyMapSystemScale(galaxy),
            centerX: sys.xpos,
            centerY: sys.ypos,
            indicator: selectedHabitat !== null ? { selected: selectedHabitat, system: sys } : null,
            selectedHabitats: selection.habitats,
            systemName: sys.name,
        });
    };

    /** Show a system / habitat (method_152 / gmapMain_MouseUp / picSystemMap_MouseUp / method_214); `record` adds it to
     * the Back / Forward history (method_213). */
    const showHabitat = (sys: Habitat, h: Habitat, record: boolean): void => {
        selectedSystem = sys;
        selectedHabitat = h;
        if (record) galaxyMapHistoryPush(history, h);
        renderNav();
        renderInfo();
        renderLandscape();
        draw();
        drawSystemMap();
    };

    // gmapMain_MouseUp: habitat_7 = the nearest system; habitat_8 = the view filter's habitat in it when the system is
    // one of the filter's, else the system itself; method_213(habitat_8).
    const selectAt = (x: number, y: number): Habitat | null => {
        const h = findNearestSystemAt(galaxy, x, y);
        if (h !== null) {
            let hab: Habitat = h;
            if (selection.systems !== null && selection.systems.includes(h) && selection.habitats !== null) {
                for (const sh of selection.habitats) if (sh.systemIndex === h.systemIndex) hab = sh;
            }
            showHabitat(h, hab, true);
        }
        return h;
    };

    const jump = (h: Habitat): void => {
        opts.jumpTo(h.xpos, h.ypos);
        close();
    };

    const eventToWorld = (e: MouseEvent): { x: number; y: number } => {
        const r = canvas.getBoundingClientRect();
        const k = r.width > 0 ? mapPx / r.width : 1; // the window is CSS-scaled
        return mapToWorld(galaxy, mapPx, (e.clientX - r.left) * k, (e.clientY - r.top) * k);
    };
    canvas.addEventListener('mouseup', (e) => {
        if (e.button !== 0) return;
        const p = eventToWorld(e);
        selectAt(p.x, p.y);
    });
    canvas.addEventListener('dblclick', (e) => {
        const p = eventToWorld(e);
        const h = findNearestSystemAt(galaxy, p.x, p.y);
        if (h !== null) jump(h);
    });
    // picSystemMap_MouseUp / _MouseDoubleClick: the nearest habitat to the clicked point; an Unexplored system's
    // habitats are not selectable.
    const systemMapHit = (e: MouseEvent): Habitat | null => {
        const sys = selectedSystem;
        if (sys === null) return null;
        const r = sysCanvas.getBoundingClientRect();
        const k = r.width > 0 ? SYSTEM_MAP_PX / r.width : 1;
        const p = systemViewWorldAt(sys, SYSTEM_MAP_PX, SYSTEM_MAP_PX, galaxyMapSystemScale(galaxy), (e.clientX - r.left) * k, (e.clientY - r.top) * k);
        const h = findNearestHabitatNear(galaxy, p.x, p.y);
        if (h === null) return null;
        if (player !== GOD_MODE_PLAYER && galaxy.playerEmpire !== null && galaxy.playerEmpire.visibility.checkSystemVisibilityStatus(h.systemIndex) === SystemVisibilityStatus.Unexplored) return null;
        return h;
    };
    sysCanvas.addEventListener('mouseup', (e) => {
        if (e.button !== 0) return;
        const h = systemMapHit(e);
        if (h === null || selectedSystem === null) return;
        showHabitat(selectedSystem, h, true);
    });
    sysCanvas.addEventListener('dblclick', (e) => {
        const h = systemMapHit(e);
        if (h !== null) jump(h);
    });
    // btnGalaxyMapBack_Click / btnGalaxyMapForward_Click → method_214(habitat): habitat_8 = it, habitat_7 = its star.
    backBtn.addEventListener('click', () => {
        const h = galaxyMapHistoryBack(history);
        if (h !== null) showHabitat(galaxy.determineHabitatSystemStar(h) ?? h, h, false);
        renderNav();
    });
    fwdBtn.addEventListener('click', () => {
        const h = galaxyMapHistoryForward(history);
        if (h !== null) showHabitat(galaxy.determineHabitatSystemStar(h) ?? h, h, false);
        renderNav();
    });
    // pnlGalaxyMapKey (Main.Part11.cs method_129 / method_130): a 300 x 418 BorderPanel with the title, the MapKey
    // control (pnlGalaxyMapKeyActual 280 x 368, here 280 x 386 inside a 300 x 436 panel for the extra Current Main View row at (10, 40)) and a Close button (140, 10).
    const closeKey = (): void => {
        const k = keyWin;
        keyWin = null;
        k?.close();
    };
    const toggleKey = (): void => {
        if (keyWin !== null) {
            closeKey();
            return;
        }
        const kw = openOriginalWindow({ id: 'galaxymap-key', title: 'Map Key', width: 300, height: 436, headerless: true, noAutoPause: true, onClose: () => { if (keyWin === kw) keyWin = null; } });
        keyWin = kw;
        kw.root.classList.add('gmap-key-layer');
        kw.frame.classList.add('gmap-key');
        kw.body.append(
            place(owText('Map Key', { size: FONT.header, bold: true, color: '#fff' }), 7, 7),
            place(glassButton('Close', { size: FONT.small, onClick: closeKey }), 137, 7, 150, 25),
        );
        const actual = place(gradientPanel({ corners: { tl: true, br: true } }), 7, 37, 280, 386);
        actual.classList.add('gmap-key-actual');
        const section = (title: string, y: number): number => {
            actual.appendChild(place(owText(title, { size: FONT.large, bold: true, color: '#fff' }), 10, y));
            return y + 21; // RowHeight * 1.5
        };
        const item = (c: string, label: string, y: number, rect = false): number => {
            const sw = place(el('span', rect ? 'gmap-swatch gmap-swatch-rect' : 'gmap-swatch'), 10, y + 3);
            if (!rect) sw.style.background = c;
            actual.append(sw, place(owText(label, { size: FONT.tiny, color: COLORS.gridText, shadow: false }), 26, y));
            return y + 14; // MapKey._RowHeight
        };
        // MapKey.DrawColorKey: three sections of rows.
        let y = section('Galaxy Map', 10);
        for (const [c, l] of [
            ['rgb(255, 255, 0)', 'Main Sequence star system'],
            ['rgb(255, 0, 0)', 'Red Giant or Super Giant star system'],
            ['rgb(255, 255, 255)', 'White Dwarf star system'],
            ['rgb(0, 255, 255)', 'Neutron star system'],
            ['rgb(128, 0, 128)', 'Supernova star'],
            ['rgb(0, 0, 176)', 'Black Hole'],
            ['rgb(238, 130, 238)', 'Gas Cloud'],
        ] as const) y = item(c, l, y);
        y = item('', 'Current Main View', y, true) + 14;
        y = section('System Map', y);
        for (const [c, l] of [
            ['rgb(0, 128, 0)', 'Continental planet or moon'],
            ['rgb(255, 255, 0)', 'Marshy Swamp planet or moon'],
            ['rgb(244, 164, 96)', 'Desert planet or moon'],
            ['rgb(0, 0, 255)', 'Ocean planet or moon'],
            ['rgb(0, 255, 255)', 'Ice planet or moon'],
            ['rgb(255, 69, 0)', 'Volcanic planet or moon'],
            ['rgb(64, 64, 64)', 'Barren Rock planet, moon or Asteroid'],
            ['rgb(255, 0, 0)', 'Gas Giant planet'],
            ['rgb(255, 20, 147)', 'Frozen Gas Giant planet'],
        ] as const) y = item(c, l, y);
        y = section('Filtered View Items', y + 14);
        y = item(SELECTED_COLOR, 'Item matching view filter', y);
        item(DIMMED_COLOR, 'Item not matching view filter', y);
        kw.body.appendChild(actual);
    };

    backBtn.addEventListener('click', () => {
        const h = galaxyMapHistoryBack(history);
        if (h !== null) showHabitat(galaxy.determineHabitatSystemStar(h) ?? h, h, false);
        renderNav();
    });
    fwdBtn.addEventListener('click', () => {
        const h = galaxyMapHistoryForward(history);
        if (h !== null) showHabitat(galaxy.determineHabitatSystemStar(h) ?? h, h, false);
        renderNav();
    });

    function open(selected: Habitat | null = null): void {
        if (isOpen) return;
        isOpen = true;
        opts.onOpen?.();
        if (resourceId === null && resources.length > 0) resourceId = resources[0].resourceId;
        // pnlGalaxyMap: ScreenPanel 945 × 760 (method_131), HeaderIcon galaxyMap.png.
        const w = openOriginalWindow({
            id: 'galaxymap',
            title: 'Galaxy Map',
            icon: 'galaxyMap.png',
            width: WIN_W + (listShown ? LIST_W : 0),
            height: WIN_H,
            onResize: () => resizeCanvases(),
            onClose: () => close(),
        });
        win = w;
        w.root.classList.add('gmap-overlay');
        // Keys typed inside the window (e.g. in a combo) don't reach the game; Esc still closes it.
        w.root.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') e.stopPropagation();
        });
        mount(w);
        // method_131 → method_152(habitat_9): the selected habitat's system and the habitat itself.
        if (selected !== null) {
            selectedSystem = galaxyMapSystemOf(galaxy, selected);
            selectedHabitat = selected;
        }
        resizeCanvases();
        recompute();
        renderNav();
        renderInfo();
        renderLandscape();
    }

    function close(): void {
        if (!isOpen) return;
        isOpen = false;
        closeKey();
        const w = win;
        win = null;
        w?.close();
        // method_132: habitatList_0.Clear(); int_24 = 0.
        galaxyMapHistoryClear(history);
        opts.onClose?.();
    }

    return {
        element: root,
        get isOpen() {
            return isOpen;
        },
        open,
        close,
        destroy: () => {
            close();
            root.remove();
        },
        toggle: (selected?: Habitat | null) => (isOpen ? close() : open(selected ?? null)),
        setViewMode: (m: GalaxyMapViewMode) => {
            mode = m;
            viewSel.value = String(m);
            recompute();
        },
        selectAt,
        get selectedHabitat() {
            return selectedHabitat;
        },
        get selectedSystem() {
            return selectedSystem;
        },
        back: () => backBtn.click(),
        forward: () => fwdBtn.click(),
        redraw: () => draw(),
    };
}

/** "Continental planet", "Ice moon", "Asteroid field" — the habitat's type and category in words. */
function habitatTypeWords(h: Habitat): string {
    if (h.category === HabitatCategoryType.Asteroid) return 'Asteroid field';
    const t = HabitatType[h.type].replace(/([a-z])([A-Z])/g, '$1 $2');
    const c = HabitatCategoryType[h.category].replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    return `${t} ${c}`;
}
