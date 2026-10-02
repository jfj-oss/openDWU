// The top of the screen, ported from the original (pure: no DOM). Every rect is in the original's pixels, laid out
// with the original's formulas over a "virtual" window width; hud.ts scales the whole strip by one factor
// (topBarScale) so it stays proportional to the window height (crisp at 4K / HiDPI), like the selection frame.
//
// Sources: Main.Part12.cs MainInit 1714-1804 (lstMessages, the history buttons, the screen-button row, the game menu /
// help / play-pause / speed buttons), MainView.cs method_18 (date + speed text, money / cashflow / bonus income, the
// system name), ResearchButton.cs (the research progress readout), Main.Part11.cs method_149 (the system name text).

import type { ResearchSystem, TechNode } from '../sim/researchSystem';
import { HabitatCategoryType, HabitatType } from '../sim/types';
import { SystemVisibilityStatus } from '../sim/visibility';
import { GalaxyLocationType } from '../sim/galaxyLocation';

export interface TopRect { x: number; y: number; w: number; h: number }

/** Rounded corners of a GlassButton (SetCornerCurves topLeft, topRight, bottomRight, bottomLeft). */
export type CornerCurves = readonly [tl: boolean, tr: boolean, br: boolean, bl: boolean];

export interface TopButtonSpec {
    name: string;
    w: number;
    h: number;
    corners: CornerCurves;
}

const NONE: CornerCurves = [false, false, false, false];
const BL: CornerCurves = [false, false, false, true];
const BR: CornerCurves = [false, false, true, false];

/** The screen-button row under the message box, left to right (Main.Part12.cs 1727-1789): five 32 × 32 buttons, the
 *  five 64-high centre buttons (characters, diplomacy, empire summary, research, designs), five more 32 × 32. */
export const TOP_ROW_BUTTONS: readonly TopButtonSpec[] = [
    { name: 'tbtnColonies', w: 32, h: 32, corners: BL },
    { name: 'btnExpansionPlanner', w: 32, h: 32, corners: NONE },
    { name: 'btnEmpireGraphs', w: 32, h: 32, corners: NONE },
    { name: 'btnEmpirePolicy', w: 32, h: 32, corners: NONE },
    { name: 'btnGameEditor', w: 32, h: 32, corners: NONE },
    { name: 'tbtnIntelligenceAgents', w: 32, h: 64, corners: BL },
    { name: 'tbtnEmpires', w: 80, h: 64, corners: NONE },
    { name: 'btnEmpireSummary', w: 80, h: 64, corners: NONE },
    { name: 'tbtnResearch', w: 80, h: 64, corners: NONE },
    { name: 'tbtnDesigns', w: 32, h: 64, corners: BR },
    { name: 'btnBuildOrder', w: 32, h: 32, corners: NONE },
    { name: 'tbtnConstructionYards', w: 32, h: 32, corners: NONE },
    { name: 'tbtnBuiltObjects', w: 32, h: 32, corners: NONE },
    { name: 'tbtnShipGroups', w: 32, h: 32, corners: NONE },
    { name: 'tbtnTroops', w: 32, h: 32, corners: BR },
];

/** Width of the row: 10 × 32 + 3 × 80 + 2 × 32 = 624, centred by num4 = (Width - 624) / 2. */
export const TOP_ROW_WIDTH = TOP_ROW_BUTTONS.reduce((s, b) => s + b.w, 0);

/** The top-left controls in the original's pixels (Main.Part12.cs 1790-1804). */
export const TOP_LEFT_BUTTONS: readonly (TopButtonSpec & { x: number; y: number })[] = [
    { name: 'btnGameMenu', x: 10, y: 10, w: 40, h: 40, corners: [true, false, false, true] },
    { name: 'btnHelp', x: 50, y: 10, w: 40, h: 40, corners: [false, true, true, false] },
    { name: 'btnPlayPause', x: 10, y: 62, w: 80, h: 34, corners: [true, true, false, false] },
    { name: 'btnGameSpeedDecrease', x: 10, y: 96, w: 40, h: 20, corners: [false, false, false, true] },
    { name: 'btnGameSpeedIncrease', x: 50, y: 96, w: 40, h: 20, corners: [false, false, true, false] },
];

/** The date text: MainView.cs method_18 DrawStringDropShadow(..., 12, 120). */
export const TOP_DATE_POS = { x: 12, y: 120 } as const;

/** The top-left area (buttons + the date line) in the original's pixels. */
export const TOP_LEFT_AREA: TopRect = { x: 0, y: 0, w: 230, h: 146 };

/**
 * The money block (MainView.cs method_18): num2 = Width - 95; the values are drawn from num2 (left-aligned), the grey
 * labels to their left, the money icon at num2 - (icon width + 73). The block here spans Width - 210 .. Width;
 * positions inside it are relative to its left edge (num2 sits at 115). The system name (string_22) is drawn at
 * Width - (text width + 40), y 67: right-aligned 40 px from the edge.
 */
export const MONEY_BLOCK_W = 210;
export const MONEY_BLOCK_H = 94;
export const MONEY_NUM2 = MONEY_BLOCK_W - 95;
export const MONEY_POS = {
    icon: { x: MONEY_NUM2 - (32 + 73), y: 12 },
    moneyLabel: { x: MONEY_NUM2 - 57, y: 7 },
    money: { x: MONEY_NUM2, y: 4 },
    cashflowLabel: { x: MONEY_NUM2 - 71, y: 27 },
    cashflow: { x: MONEY_NUM2 - 4, y: 27 },
    bonusLabel: { x: MONEY_NUM2 - 103, y: 47 },
    bonus: { x: MONEY_NUM2 - 4, y: 45 },
    systemName: { right: 40, y: 67 },
} as const;

/** The selection frame's look: the original's pixels drawn ~1.71× at a 1080 px tall window (hud.ts
 *  SELECTION_FRAME_BASE_SCALE); the top strip uses the same factor so the two match. */
export const TOP_BASE_SCALE = 683 / 399;
/** Narrowest virtual width the strip needs: the money block (210) clear of the centred message box + its history
 *  buttons (700): (W + 700) / 2 <= W - 210 → W >= 1120. */
export const TOP_MIN_VIRTUAL_WIDTH = 1120;

/** The strip's CSS scale: the base scale at 1080 px window height, proportional to the height, times the UI scale
 *  setting; capped so the strip's virtual width never drops below TOP_MIN_VIRTUAL_WIDTH (narrow / 4:3 windows). */
export function topBarScale(viewportWidth: number, viewportHeight: number, uiScale: number): number {
    const byHeight = TOP_BASE_SCALE * Math.max(0.5, viewportHeight / 1080) * uiScale;
    const byWidth = viewportWidth / TOP_MIN_VIRTUAL_WIDTH;
    return Math.max(0.25, Math.min(byHeight, byWidth));
}

/**
 * Port of Main.Part12.cs MainInit 1714-1789 over a virtual window `width` (screen width / scale): the message box at
 * num3 = (Width - 700) / 2, its history buttons at num3 + 668, the button row from num4 = (Width - 624) / 2 at y 90.
 * Also the top-left area, the money block (right edge) and the overflow button for our extra screens (below the
 * hourglass, right after the row). All in the original's pixels.
 */
export function topBarLayout(width: number): Record<string, TopRect> {
    const out: Record<string, TopRect> = {};
    const num3 = Math.trunc((width - 700) / 2);
    out['lstMessages'] = { x: num3, y: 10, w: 668, h: 80 };
    out['btnHistoryMessages'] = { x: num3 + 668, y: 10, w: 32, h: 48 };
    out['btnGalacticHistory'] = { x: num3 + 668, y: 58, w: 32, h: 32 };
    let num5 = Math.trunc((width - 624) / 2);
    for (const b of TOP_ROW_BUTTONS) {
        out[b.name] = { x: num5, y: 90, w: b.w, h: b.h };
        num5 += b.w;
    }
    // Small tweak: our screens without an original button sit behind one overflow button in the empty slot under
    // the hourglass, flush with the row.
    out['btnTopMore'] = { x: num3 + 668, y: 90, w: 32, h: 32 };
    out['pnlTopLeftBar'] = { ...TOP_LEFT_AREA };
    out['pnlMoney'] = { x: width - MONEY_BLOCK_W, y: 0, w: MONEY_BLOCK_W, h: MONEY_BLOCK_H };
    return out;
}

/** Names of the top-strip elements (the keys of topBarLayout). */
export const TOP_ELEMENT_NAMES: readonly string[] = Object.keys(topBarLayout(1920));

/** Screen-space rects of the top strip (original pixels × scale), e.g. for the stub list under the money block. */
export function topBarScreenLayout(viewportWidth: number, viewportHeight: number, uiScale = 1): { scale: number; rects: Record<string, TopRect> } {
    const k = topBarScale(viewportWidth, viewportHeight, uiScale);
    const rects: Record<string, TopRect> = {};
    for (const [name, r] of Object.entries(topBarLayout(viewportWidth / k))) {
        rects[name] = { x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k };
    }
    return { scale: k, rects };
}

/** CSS border-radius for a GlassButton's corner curves (radius in original pixels). */
export function cornerRadiusCss(c: CornerCurves, r = 7): string {
    return c.map((on) => (on ? `${r}px` : '0')).join(' ');
}

// ---------------------------------------------------------------------------------------------------------------
// Research progress readout (ResearchButton.cs DrawResearchInfo / DrawIndustryRow)
// ---------------------------------------------------------------------------------------------------------------

export interface ResearchReadoutRow {
    /** Row origin inside the 80 × 64 button: (3, 5), (3, 23), (3, 41). */
    y: number;
    /** The field's colour (ARGB from DrawIndustryRow) as CSS. */
    color: string;
    /** "58%" for the first project in the field's queue, "  -----" when the queue is empty. */
    text: string;
    /** The project being researched (its icon is drawn left of the percentage), or null. */
    node: TechNode | null;
}

/** .NET `x.ToString("0%")`: ×100, rounded half away from zero, no decimals. */
export function formatPercent0Net(x: number): string {
    if (!Number.isFinite(x)) return x > 0 ? '∞' : x < 0 ? '-∞' : 'NaN';
    const v = x * 100;
    return `${Math.sign(v) * Math.round(Math.abs(v))}%`;
}

/** Port of ResearchButton.cs DrawIndustryRow for Weapon / Energy / HighTech: each field's colour and the progress of
 *  the head of its research queue (Progress / Cost as "0%"). */
export function researchReadout(research: Pick<ResearchSystem, 'researchQueueWeapons' | 'researchQueueEnergy' | 'researchQueueHighTech'> | null): ResearchReadoutRow[] {
    const rows: [TechNode[] | undefined, string, number][] = [
        [research?.researchQueueWeapons, 'rgba(255, 32, 64, 0.753)', 5],
        [research?.researchQueueEnergy, 'rgb(96, 64, 255)', 23],
        [research?.researchQueueHighTech, 'rgba(32, 255, 64, 0.753)', 41],
    ];
    return rows.map(([queue, color, y]) => {
        const node = queue !== undefined && queue.length > 0 ? queue[0] : null;
        return { y, color, node, text: node !== null ? formatPercent0Net(node.progress / node.cost) : '  -----' };
    });
}

// ---------------------------------------------------------------------------------------------------------------
// System name under the money block (Main.Part11.cs method_149 → string_22)
// ---------------------------------------------------------------------------------------------------------------

export interface SystemNameHabitat {
    name: string;
    xpos: number;
    ypos: number;
    systemIndex: number;
    category: HabitatCategoryType;
    type: HabitatType;
}

export interface SystemNameGalaxy {
    fastFindNearestSystem(x: number, y: number): SystemNameHabitat | null;
    determineGalaxyLocationsAtPoint(x: number, y: number): readonly { type: GalaxyLocationType; name: string }[];
}

export interface SystemNamePlayer {
    visibility: {
        checkSystemVisibilityStatus(systemIndex: number): SystemVisibilityStatus;
        knownGalaxyLocations: readonly unknown[];
    };
}

/** Galaxy.MaxSolarSystemSize. */
const MAX_SOLAR_SYSTEM_SIZE = 23000;

/** Port of Main.Part11.cs method_149's string_22: the nearest system to the view centre ("Name system", "Name Black
 *  Hole", "Name Nova", "Name Gas Cloud", "(Unexplored System)" / "(Unexplored Gas Cloud)"), a known super nova /
 *  restricted area at the point, or "(Deep Space)". `displayName` lets the caller substitute a scenario name. */
export function viewSystemName(galaxy: SystemNameGalaxy, player: SystemNamePlayer | null, x: number, y: number, displayName: (h: SystemNameHabitat) => string = (h) => h.name): string {
    const deepSpace = '(Deep Space)';
    const h = galaxy.fastFindNearestSystem(x, y);
    if (h === null) return deepSpace;
    if (Math.hypot(h.xpos - x, h.ypos - y) <= MAX_SOLAR_SYSTEM_SIZE + 500) {
        const status = player?.visibility.checkSystemVisibilityStatus(h.systemIndex) ?? SystemVisibilityStatus.Explored;
        if (status !== SystemVisibilityStatus.Explored && status !== SystemVisibilityStatus.Visible) {
            return h.category === HabitatCategoryType.GasCloud ? '(Unexplored Gas Cloud)' : '(Unexplored System)';
        }
        const name = displayName(h);
        switch (h.type) {
            case HabitatType.MainSequence:
            case HabitatType.RedGiant:
            case HabitatType.SuperGiant:
            case HabitatType.WhiteDwarf:
            case HabitatType.Neutron:
                return `${name} system`;
            case HabitatType.BlackHole:
                return `${name} Black Hole`;
            case HabitatType.SuperNova:
                return `${name} Nova`;
            case HabitatType.Hydrogen:
            case HabitatType.Helium:
            case HabitatType.Argon:
            case HabitatType.Ammonia:
            case HabitatType.CarbonDioxide:
            case HabitatType.Oxygen:
            case HabitatType.NitrogenOxygen:
            case HabitatType.Chlorine:
                return `${name} Gas Cloud`;
            default:
                return name;
        }
    }
    let value = '';
    const known = player?.visibility.knownGalaxyLocations ?? [];
    for (const loc of galaxy.determineGalaxyLocationsAtPoint(x, y)) {
        if (loc.type === GalaxyLocationType.SuperNova && value === '' && known.includes(loc)) value = loc.name;
        else if (loc.type === GalaxyLocationType.RestrictedArea && known.includes(loc)) value = loc.name;
    }
    return value !== '' ? value : deepSpace;
}

/** MainView.cs method_18: the system name is drawn only while the zoom factor (world units per pixel) is below 100. */
export function showViewSystemName(cameraZoom: number): boolean {
    return cameraZoom > 0 && 1 / cameraZoom < 100;
}
