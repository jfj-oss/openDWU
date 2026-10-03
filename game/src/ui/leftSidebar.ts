// Left sidebar: a port of the original's "Empire Navigation Tool" — the ItemListCollectionPanel drawn over the left
// edge of the main view (DistantWorlds/ItemListCollectionPanel.cs + ItemListPanel.cs, set up in Main.Part11.cs
// method_163 and laid out by Main.Part2.cs method_666). A column of 26 × 26 category buttons, vertically centred in
// its area; clicking one opens the panel beside it: a title bar ("Construction Ships (3)", size-cycle and close
// icons), optional toggle buttons, scroll-up / scroll-down bars and 41 px item rows (picture, bold name, small
// "(sub-role)", and a second line with the mission / fuel / firepower / ...).
//
// This file is the pure part (no DOM): the panel set and order, the geometry (all in the original's pixels — the
// view scales it with the HUD), the per-panel item lists (BaconMain.PopulateListsOnLefthandSide, vanilla ordering)
// and the row models (ItemListPanel.cs method_6), so it is unit-tested without a browser. leftSidebarView.ts draws it.
//
// TODO(port): "Enemy Targets" panel (PrioritizedTarget rows, Main.method_205 + ItemListPanel.cs method_8/method_9, the
//   click-to-assign-a-fleet behaviour of Main.Part12.cs method_78) — the target prioritisation is not ported.
// TODO(port): "Pirate Missions" panel (EmpireActivity rows, ItemListPanel.cs method_7) — pirate playstyle only.
// TODO(port): colony governor / fleet admiral portraits on the rows (characterImageCache ObtainCharacterImageVerySmall)
//   — there is no character art; the Characters panel shows the character's race portrait instead.
// TODO(port): the pirate player's Colonies rows (ItemListPanel.cs 729-848: other empires' colonies with pirate
//   control %) — pirate playstyle only.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { BuiltObject } from '../sim/builtObject';
import type { Race } from '../sim/data/races';
import { Character } from '../sim/characters';
import type { ConstructionQueue } from '../sim/construction/constructionQueue';
import { BuiltObjectSubRole } from '../sim/builtObjectTypes';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import { BuiltObjectMissionType } from '../sim/missions/mission';
import { ShipGroup } from '../sim/fleets/shipGroup';
import { Habitat, HabitatCategoryType, IndustryType } from '../sim/types';
import { GalaxyLocation, GalaxyLocationType } from '../sim/galaxyLocation';
import { TroopType } from '../sim/cargo';
import { FleetPosture } from '../sim/diplomacyTick';
import { resolveNewShipImageIndex } from '../sim/shipImageHelper';
import { resolveSubRoleDescription } from '../sim/designGeneration';
import { habitatDevelopmentLevel } from '../sim/developmentLevel';
import { empireApprovalRating } from '../sim/taxes';
import { habitatAnnualRevenue } from '../sim/forceStructure';
import { checkBasesToBeBuiltAtHabitat, checkColonizingHabitat, determineResortBaseBuildLocations, identifyColonizationTargetsFull } from '../sim/civilianAI';
import { identifyResourceCentres } from '../sim/resourceTargets';
import { determineResearchStationLocation } from '../sim/stationPlacement';
import { resolveSectorDescription } from '../sim/empireEvents';
import { builtObjectImageUrl, resolveDrawPictureRef } from '../render/builtObjectLayer';
import { fighterImageUrl } from '../render/fighterLayer';
import { troopImageUrl } from '../render/troopImages';
import { mapStarUrls, cloudUrls } from '../render/assets';
import { racePortraitUrl } from './empireEmblem';
import { chromeUrl, fmtK, habitatImageUrl, missionDescription, shipImageUrl } from './selectionInfo';
import { resourceIconUrl } from './hud';
import { plannerStatusInput, type PlannerStatusInput } from './screens/expansionPlanner';
import { resolveDescriptionCharacterTask, resolveRoleDescription } from './screens/intelligence';

// ---------------------------------------------------------------------------------------------------------------
// Panels (Main.Part11.cs method_163 AddPanel order)
// ---------------------------------------------------------------------------------------------------------------

export type ItemPanelId =
    | 'colonies'
    | 'characters'
    | 'spacePorts'
    | 'miningStations'
    | 'constructionShips'
    | 'explorationShips'
    | 'fleets'
    | 'militaryShips'
    | 'potentialColonies'
    | 'potentialMining'
    | 'potentialResearch'
    | 'potentialResort'
    | 'specialLocations'
    | 'idleShips';

/** The category button's icon: a chrome image, a race portrait or a ship picture (rotated 270°, as method_163 does
 *  with RotateFlip(Rotate270FlipNone)). */
export type PanelIcon = { kind: 'chrome'; file: string } | { kind: 'race' } | { kind: 'ship'; subRole: BuiltObjectSubRole } | { kind: 'shipRef'; pictureRef: number };

export interface ItemPanelDef {
    id: ItemPanelId;
    title: string;
    icon: PanelIcon;
    /** ItemListPanel toggle buttons: one string[] of states per button (click cycles them). */
    toggles: readonly (readonly string[])[];
    /** AddPanel itemHeightOverrideFactor. */
    itemHeightFactor: number;
    /** Not in the original (kept from our old cycle chips). */
    extra?: boolean;
}

/** Port of Main.Part11.cs method_163: the panels in their original order. Enemy Targets and Pirate Missions are not
 *  ported (see the TODOs above); "Idle Ships" is our extra (the old Idle chip), after the original set. */
export function itemPanelDefs(isPirate: boolean): ItemPanelDef[] {
    const out: ItemPanelDef[] = [
        { id: 'colonies', title: 'Colonies', icon: { kind: 'chrome', file: 'colony.png' }, toggles: [], itemHeightFactor: 1 },
        { id: 'characters', title: 'Characters', icon: { kind: 'race' }, toggles: [], itemHeightFactor: 1 },
        { id: 'spacePorts', title: 'Space Ports / Construction Yards', icon: { kind: 'ship', subRole: BuiltObjectSubRole.LargeSpacePort }, toggles: [], itemHeightFactor: 1 },
        { id: 'miningStations', title: 'Mining Stations', icon: { kind: 'ship', subRole: BuiltObjectSubRole.MiningStation }, toggles: [], itemHeightFactor: 1 },
        { id: 'constructionShips', title: 'Construction Ships', icon: { kind: 'chrome', file: 'build.png' }, toggles: [], itemHeightFactor: 1 },
        { id: 'explorationShips', title: 'Exploration Ships', icon: { kind: 'ship', subRole: BuiltObjectSubRole.ExplorationShip }, toggles: [], itemHeightFactor: 1 },
        { id: 'fleets', title: 'Fleets', icon: { kind: 'chrome', file: 'fleetLeader.png' }, toggles: [], itemHeightFactor: 1 },
        {
            id: 'militaryShips',
            title: 'Military Ships',
            icon: { kind: 'chrome', file: 'firepower.png' },
            toggles: [['Excluding Ships in Fleets', 'Including Ships in Fleets']],
            itemHeightFactor: 1,
        },
    ];
    if (!isPirate) {
        out.push({
            id: 'potentialColonies',
            title: 'Potential Colonies',
            icon: { kind: 'chrome', file: 'colonize.png' },
            toggles: [['Hiding low-quality colonies', 'Showing low-quality colonies']],
            itemHeightFactor: 1,
        });
    }
    out.push(
        { id: 'potentialMining', title: 'Potential Mining Locations', icon: { kind: 'chrome', file: 'mine.png' }, toggles: [['Excluding Asteroids', 'Including Asteroids']], itemHeightFactor: 1 },
        { id: 'potentialResearch', title: 'Potential Research Locations', icon: { kind: 'chrome', file: 'research_small.png' }, toggles: [], itemHeightFactor: 1 },
        { id: 'potentialResort', title: 'Potential Resort Locations', icon: { kind: 'chrome', file: 'scenery.png' }, toggles: [], itemHeightFactor: 1 },
        // ShipImageHelper.PlanetDestroyer = image index 0 (other/planetdestroyer.png).
        { id: 'specialLocations', title: 'Special Locations', icon: { kind: 'shipRef', pictureRef: 0 }, toggles: [], itemHeightFactor: 1 },
        { id: 'idleShips', title: 'Idle Ships', icon: { kind: 'chrome', file: 'stop.png' }, toggles: [], itemHeightFactor: 1, extra: true },
    );
    return out;
}

/** The URL of a panel button's icon for the player empire, and whether it is rotated 270° (ship art). */
export function panelIconUrl(icon: PanelIcon, player: Pick<Empire, 'dominantRace' | 'pirateEmpireBaseHabitat'>): { url: string | null; rotate: boolean } {
    switch (icon.kind) {
        case 'chrome':
            return { url: chromeUrl(icon.file), rotate: false };
        case 'race':
            return { url: player.dominantRace ? racePortraitUrl(player.dominantRace.pictureIndex) : null, rotate: false };
        case 'ship':
            return { url: builtObjectImageUrl(resolveNewShipImageIndex(icon.subRole, player.dominantRace, player.pirateEmpireBaseHabitat !== null)), rotate: true };
        case 'shipRef':
            return { url: builtObjectImageUrl(icon.pictureRef), rotate: true };
    }
}

/** Hover hint of a category button (ItemListCollectionPanel.DetectHoveredElement). */
export function panelButtonHint(title: string, open: boolean): string {
    return `${title}: ${open ? 'click to close items' : 'click to show items'}`;
}

/** The header text: the title plus " (count)" when there are items (ItemListPanel.DrawPanel). */
export function panelTitleText(title: string, count: number): string {
    return count > 0 ? `${title} (${count})` : title;
}

/** "(No ITEMS)" → "(No Construction Ships)" (ItemListPanel method_5, GameText "No ITEMS" = "No {0}"). */
export function noItemsText(title: string): string {
    return `(No ${title})`;
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry (original pixels)
// ---------------------------------------------------------------------------------------------------------------

/** ItemListCollectionPanel.SetSizeFactor: the navigation tool's size steps (gameOptions EmpireNavigationToolSize). */
export function snapSizeFactor(sizeFactor: number): number {
    if (sizeFactor <= 1) return 1;
    if (sizeFactor <= 1.33) return 1.33;
    return 1.77;
}

/** ItemListCollectionPanel.CycleChangeSize: 1 → 1.33 → 1.77 → 1. */
export function nextSizeFactor(sizeFactor: number): number {
    const f = snapSizeFactor(sizeFactor);
    return f <= 1 ? 1.33 : f <= 1.33 ? 1.77 : 1;
}

/** ItemListPanel's metrics at a size factor (SetSizeFactor: Default* × factor, truncated). */
export interface PanelMetrics {
    titleBar: number;
    toggle: number;
    scrollUp: number;
    scrollDown: number;
    item: number;
    gap: number;
    scrollPerClick: number;
    /** ItemListCollectionPanel.ImageSize (30 × factor). */
    imageSize: number;
}

export function panelMetrics(sizeFactor: number, itemHeightFactor = 1): PanelMetrics {
    const f = snapSizeFactor(sizeFactor);
    return {
        titleBar: Math.trunc(18 * f),
        toggle: Math.trunc(14 * f),
        scrollUp: Math.trunc(14 * f),
        scrollDown: Math.trunc(14 * f),
        item: Math.trunc(41 * itemHeightFactor * f),
        gap: 2,
        scrollPerClick: Math.trunc(25 * f),
        imageSize: Math.trunc(30 * f),
    };
}

export interface ItemListArea {
    /** ItemListCollectionPanel.Area. */
    x: number;
    y: number;
    w: number;
    h: number;
    /** SelectionButtonWidth / Height. */
    button: number;
    /** The category icon's box (min(button - 6, 16 × factor)). */
    icon: number;
}

/**
 * Port of Main.Part2.cs method_666: the tool's area for a client of `clientHeight` original pixels whose selection
 * panel (pnlInfoPanel) starts at `infoPanelTop`. num3..num7 come from Panels[0] exactly as the source reads them
 * (DefaultItemHeight unscaled, the bars scaled).
 */
export function itemListArea(clientHeight: number, infoPanelTop: number, sizeFactor: number): ItemListArea {
    const f = snapSizeFactor(sizeFactor);
    const m = panelMetrics(f);
    const num = infoPanelTop - 200;
    const button = Math.max(1, Math.min(Math.trunc(26 * f), Math.trunc(num / 15)));
    const num8 = m.titleBar + 1 + m.scrollUp + 1 + m.scrollDown + m.gap;
    const num9 = 41 + m.gap;
    const num10 = Math.min(10, 5 + Math.trunc((clientHeight - 793) / num9));
    const val2 = num8 + num10 * num9;
    const h = Math.max(0, Math.min(num, val2));
    const y = 150 + Math.trunc((num - h) / 2);
    return { x: 8, y, w: Math.trunc(300 * f), h, button, icon: Math.max(1, Math.min(button - 6, Math.trunc(16 * f))) };
}

/** Top of the button column inside the area (DrawPanel: (Area.Height - count × button) / 2, clamped to 0 when it
 *  would start above the area, as DrawPanelToImage does). */
export function buttonColumnTop(area: Pick<ItemListArea, 'h' | 'button'>, panelCount: number): number {
    return Math.max(0, Math.trunc((area.h - panelCount * area.button) / 2));
}

/** The height of the panel's fixed parts (title + bars + the 4 px BindData margin + the toggles). */
export function panelChromeHeight(m: PanelMetrics, toggleCount: number): number {
    return m.titleBar + 1 + m.scrollUp + 1 + m.scrollDown + 4 + (toggleCount > 0 ? m.toggle * toggleCount + 1 : 0);
}

/** ItemListPanel.BindData / CheckScrollWheel: the largest scroll position. */
export function maxScroll(itemCount: number, m: PanelMetrics, areaHeight: number, toggleCount: number): number {
    return Math.max(0, itemCount * (m.item + m.gap) - m.gap - (areaHeight - panelChromeHeight(m, toggleCount)));
}

export function clampScroll(pos: number, itemCount: number, m: PanelMetrics, areaHeight: number, toggleCount: number): number {
    return Math.min(maxScroll(itemCount, m, areaHeight, toggleCount), Math.max(0, Math.trunc(pos)));
}

/** ItemListPanel method_5 / method_10: the first and last item index drawn for a scroll position. */
export function visibleItemRange(scroll: number, viewHeight: number, itemCount: number, m: PanelMetrics): { first: number; last: number } {
    const step = m.item + m.gap;
    const first = Math.trunc(scroll / step);
    const last = Math.min(itemCount - 1, Math.trunc((scroll + viewHeight) / step));
    return { first, last };
}

/** ItemListPanel.DrawPanel: the panel's parts, relative to the panel's top-left, for a panel `w` × `h`. */
export function panelLayout(w: number, h: number, m: PanelMetrics, toggleCount: number): {
    title: { x: number; y: number; w: number; h: number };
    toggles: { x: number; y: number; w: number; h: number }[];
    scrollUp: { x: number; y: number; w: number; h: number };
    items: { x: number; y: number; w: number; h: number };
    scrollDown: { x: number; y: number; w: number; h: number };
    sizeIcon: { x: number; y: number };
    closeIcon: { x: number; y: number };
} {
    const toggleBlock = toggleCount > 0 ? (m.toggle + 1) * toggleCount : 0;
    const num2 = h - (m.titleBar + 1 + m.scrollUp + 1 + m.scrollDown) - toggleBlock;
    const num3 = h - (m.titleBar + 1 + m.scrollUp + 1 + m.scrollDown + 3) - toggleBlock;
    const num4 = m.titleBar + 1 + m.scrollUp + 2 + toggleBlock;
    const toggles = [];
    for (let i = 0; i < toggleCount; i++) toggles.push({ x: 0, y: m.titleBar + 1 + i * (m.toggle + 1), w: w - 1, h: m.toggle });
    return {
        title: { x: 0, y: 0, w: w - 1, h: m.titleBar },
        toggles,
        scrollUp: { x: 0, y: m.titleBar + 1 + toggleBlock, w: w - 1, h: m.scrollUp },
        items: { x: 0, y: num4, w, h: Math.max(0, num3) },
        scrollDown: { x: 0, y: m.titleBar + 1 + m.scrollUp + num2 + toggleBlock, w: w - 1, h: m.scrollDown },
        sizeIcon: { x: w - (m.titleBar * 2 - 4), y: 5 },
        closeIcon: { x: w - (m.titleBar - 4), y: 5 },
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Item lists (BaconMain.PopulateListsOnLefthandSide, vanilla order: the empire's own list order)
// ---------------------------------------------------------------------------------------------------------------

export type PanelItem = Habitat | BuiltObject | ShipGroup | Character | GalaxyLocation;

function live<T>(list: readonly (T | null | undefined)[] | null | undefined): T[] {
    return (list ?? []).filter((x): x is T => x != null && !(x as { hasBeenDestroyed?: boolean }).hasBeenDestroyed);
}

/** Idle ships for our "Idle Ships" panel: the idle-ship cycler's test (Main.Part7.cs method_349 / method_350) over
 *  the whole list — idle fleets first, then idle ships not in a fleet, not bases, not being built, not automated. */
export function idleShipsList(player: Empire): (ShipGroup | BuiltObject)[] {
    const idle = (m: unknown): boolean => {
        const x = m as { type?: BuiltObjectMissionType } | null;
        return x == null || x.type === BuiltObjectMissionType.Undefined;
    };
    const out: (ShipGroup | BuiltObject)[] = [];
    for (const g of live<ShipGroup>(player.shipGroups as (ShipGroup | null)[])) if (idle(g.mission)) out.push(g);
    for (const b of live<BuiltObject>(player.builtObjects)) {
        if (b.shipGroup == null && idle(b.mission) && b.role !== BuiltObjectRole.Base && b.builtAt == null && !b.isAutoControlled) out.push(b);
    }
    return out;
}

export interface PanelListOptions {
    /** Toggle button states (index → state). */
    toggles: readonly number[];
}

/** Port of BaconMain.PopulateListsOnLefthandSide for one panel (vanilla: no distance ordering, no resource filter). */
export function panelItems(id: ItemPanelId, galaxy: Galaxy, player: Empire, o: PanelListOptions = { toggles: [] }): PanelItem[] {
    const t0 = o.toggles[0] ?? 0;
    switch (id) {
        case 'colonies':
            return live<Habitat>(player.colonies);
        case 'characters':
            return live<Character>(player.characters as (Character | null)[]);
        case 'spacePorts':
            return live<BuiltObject>(player.spacePorts);
        case 'miningStations':
            return live<BuiltObject>(player.privateBuiltObjects).filter((b) => b.subRole === BuiltObjectSubRole.GasMiningStation || b.subRole === BuiltObjectSubRole.MiningStation);
        case 'constructionShips':
            return live<BuiltObject>(player.constructionShips as (BuiltObject | null)[]);
        case 'explorationShips':
            return live<BuiltObject>(player.builtObjects).filter((b) => b.subRole === BuiltObjectSubRole.ExplorationShip);
        case 'fleets':
            return live<ShipGroup>(player.shipGroups as (ShipGroup | null)[]);
        case 'militaryShips':
            return live<BuiltObject>(player.builtObjects).filter((b) => b.role === BuiltObjectRole.Military && (t0 === 1 || b.shipGroup == null));
        case 'potentialColonies':
            return identifyColonizationTargetsFull(galaxy, player, false, 0, 100, t0 === 1, true)
                .map((x) => x.habitat)
                .filter((h): h is Habitat => h != null);
        case 'potentialMining':
            return identifyResourceCentres(galaxy, player, false, false, t0 === 1)
                .map((x) => x.habitat)
                .filter((h): h is Habitat => h != null);
        case 'potentialResearch':
            return determineResearchStationLocation(galaxy, player, true, false, false);
        case 'potentialResort':
            return determineResortBaseBuildLocations(galaxy, player)
                .map((x) => x.target)
                .filter((h): h is Habitat => h instanceof Habitat);
        case 'specialLocations':
            return player.visibility.knownGalaxyLocations.filter(
                (l) => l.type === GalaxyLocationType.DebrisField || l.type === GalaxyLocationType.PlanetDestroyer || l.type === GalaxyLocationType.RestrictedArea,
            );
        case 'idleShips':
            return idleShipsList(player);
    }
}

/** Panels whose list is costly to build (empire-wide target searches): refreshed less often by the view. */
export function isSlowPanel(id: ItemPanelId): boolean {
    return id === 'potentialColonies' || id === 'potentialMining' || id === 'potentialResearch' || id === 'potentialResort';
}

// ---------------------------------------------------------------------------------------------------------------
// Row models (ItemListPanel.cs method_6)
// ---------------------------------------------------------------------------------------------------------------

/** ConstructionStalledImage: _MessageImages[30] (BaconMain.cs LoadUiMessages). */
const STALLED_URL = '/assets/dwu/images/ui/messages/construction_stalled.png';

/** WhiteBrush (170, 170, 170): the default text colour. */
export const ROW_TEXT = 0xaaaaaa;

/** A piece of a row line, laid out left to right (gapBefore px before it), or at a fixed x (`at`, from the text
 *  column) when the source draws it at a constant offset. */
export type RowSeg =
    | { kind: 'text'; text: string; font: 'bold' | 'small'; color: number; gapBefore?: number; at?: number; maxWidth?: number }
    | { kind: 'img'; url: string; size: number; gapBefore?: number; at?: number; dotted?: boolean; title?: string; full?: boolean };

export interface RowPicture {
    url: string;
    /** Box size (ImageSize); ship art is rotated 270° (BuiltObjectImages RotateFlip). */
    size: number;
    rotate: boolean;
    x: number;
    y: number;
}

export interface ItemRowModel {
    pictures: RowPicture[];
    /** Small overlays (capital star, construction-stalled icon), at native size unless `size`; `full` = drawn without
     *  the panel's 0.6 AlphaTransparency (bitmaps the source draws directly rather than through ScaleLimitImage). */
    overlays: { url: string; x: number; y: number; size?: number; full?: boolean }[];
    /** Where the text column starts (px from the row's left). */
    textX: number;
    /** First line: name (bold) + "(description)" (small). */
    line1: RowSeg[];
    /** Second line (y + 24 × factor). */
    line2: RowSeg[];
    /** Icons drawn from the row's right edge (fleet posture / range; colonizing / base-to-build markers). */
    right: { url: string; fromRight: number; size: number; y: number; full?: boolean }[];
}

export interface RowContext {
    galaxy: Galaxy;
    player: Empire;
    sizeFactor: number;
    /** resources.txt id → picture ref. */
    resource: (id: number) => { name: string; pictureRef: number } | null;
}

/** "0,,M": millions, rounded, no separators. */
export function fmtMillionsM(v: number): string {
    return `${Math.round(v / 1e6)}M`;
}

/** .NET "0%" of a 0..1 fraction. */
function pct(f: number): string {
    return `${Math.round(f * 100)}%`;
}

/** The (scaled) constants of method_6 (num … num24, width). */
function k(ctx: RowContext): Record<string, number> {
    const f = snapSizeFactor(ctx.sizeFactor);
    const s = (v: number): number => Math.trunc(v * f);
    return {
        n3: s(3), n4: s(4), n5: s(5), n6: s(6), n8: s(8), n10: s(10), n11: s(11), n12: s(12), n13: s(13), n14: s(14), n15: s(15), n16: s(16),
        n19: s(19), n20: s(20), n22: s(22), n24: s(24), n35: s(35), n38: s(38), n40: s(40), n42: s(42), n55: s(55), n90: s(90), n111: s(111),
        n165: s(165), n176: s(176), width: s(185), image: s(30), half: Math.trunc(s(30) / 2),
    };
}

function txt(text: string, font: 'bold' | 'small', color = ROW_TEXT, extra: { gapBefore?: number; at?: number; maxWidth?: number } = {}): RowSeg {
    return { kind: 'text', text, font, color, ...extra };
}

function img(url: string | null, size: number, extra: { gapBefore?: number; at?: number; dotted?: boolean; title?: string; full?: boolean } = {}): RowSeg[] {
    return url === null ? [] : [{ kind: 'img', url, size, ...extra }];
}

function fuelText(bo: BuiltObject): string {
    return pct(bo.currentFuel / Math.max(1, bo.fuelCapacity));
}

/** The resource icons of a habitat (with the dotted yellow box for the player race's critical resources). */
function resourceSegs(ctx: RowContext, h: Habitat, half: number, gap: number): RowSeg[] {
    const crit = new Set((ctx.player.dominantRace?.criticalResources ?? []).map((r) => r.resourceId));
    const out: RowSeg[] = [];
    for (const r of h.resources) {
        const def = ctx.resource(r.resourceId);
        if (!def) continue;
        out.push({ kind: 'img', url: resourceIconUrl(def.pictureRef), size: half, gapBefore: out.length > 0 ? gap : 0, dotted: crit.has(r.resourceId), title: def.name });
    }
    return out;
}

function queueOf(x: { constructionQueue: unknown }): ConstructionQueue | null {
    return (x.constructionQueue as ConstructionQueue | null) ?? null;
}

function yardShips(q: ConstructionQueue | null): BuiltObject[] {
    const out: BuiltObject[] = [];
    for (const y of q?.constructionYards ?? []) if (y?.shipUnderConstruction != null) out.push(y.shipUnderConstruction);
    return out;
}

function deficient(x: { manufacturingQueue: unknown }): boolean {
    const q = x.manufacturingQueue as { deficientResources?: { items: unknown[] } } | null;
    return (q?.deficientResources?.items.length ?? 0) > 0;
}

function troopIconUrl(ctx: RowContext): string {
    return troopImageUrl({ type: TroopType.Infantry, pictureRef: ctx.player.troopPictureRef }, ctx.galaxy.races.length);
}

function systemStarOf(galaxy: Galaxy, h: Habitat): Habitat | null {
    return galaxy.systems[h.systemIndex]?.systemStar ?? null;
}

/** Port of ItemListPanel.cs method_1: a potential location's name colour and reason (first match wins). `colonize`
 *  = ColonizationFocus (bool_9), `mining` = MiningFocus (bool_10). */
export function itemHabitatStatus(s: PlannerStatusInput, colonize: boolean, mining: boolean): { color: number; reason: string } {
    if (colonize && !s.inRange) return { color: 0xff0000, reason: 'Too far from existing colonies' };
    if (s.specialRuins) return { color: 0x6060ff, reason: 'Special Ruins' };
    if (s.superLuxuryKnown) return { color: 0x6060ff, reason: 'Special Luxury Resources' };
    if (s.nearPirateBase) return { color: 0xffff00, reason: 'Pirate base in this system' };
    if (colonize && s.inOurSystem && s.quality >= 0.5) return { color: 0x00ff00, reason: 'In our system' };
    if (!colonize && s.inOurSystem) return { color: 0x00ff00, reason: 'In our system' };
    if (colonize && s.canColonizeBecauseAtWar && s.territoryOk) return { color: 0xff0000, reason: "In another empire's system" };
    if (mining && !s.territoryOk) return { color: 0xff0000, reason: "In another empire's system" };
    if (colonize && s.colonizationLikeliness <= -5) return { color: 0xffff00, reason: 'Hostile population' };
    if (colonize && !s.techSurvivesStorms && s.inStorm) return { color: 0xff8000, reason: 'Galactic storm' };
    if (!colonize && !s.shipsSurviveStorms && s.inStorm) return { color: 0xff8000, reason: 'Galactic storm' };
    if (colonize && s.quality < 0.5) return { color: 0xff8000, reason: 'Low quality - poor colonization' };
    if (s.dangerous) return { color: 0xffff00, reason: 'Nearby pirates or space monsters' };
    return { color: ROW_TEXT, reason: '' };
}

/** method_6, Habitat owned by an empire (the player's Colonies list). */
function colonyRow(ctx: RowContext, h: Habitat): ItemRowModel {
    const c = k(ctx);
    const owner = h.owner as Empire;
    const pictures: RowPicture[] = [];
    const overlays: ItemRowModel['overlays'] = [];
    const pic = habitatImageUrl(h);
    if (pic) pictures.push({ url: pic, size: c.image, rotate: false, x: 5, y: 5 });
    if (owner.capital === h) overlays.push({ url: chromeUrl('capital.png'), x: 2, y: 2, full: true });
    else if (owner.capitals.includes(h)) overlays.push({ url: chromeUrl('fleetLeader.png'), x: 2, y: 2, full: true }); // bitmap_43
    const race = h.population?.dominantRace as Race | null | undefined;
    if (race) pictures.push({ url: racePortraitUrl(race.pictureIndex), size: c.image, rotate: false, x: 5 + c.image + c.n5, y: c.n5 });
    const textX = 5 + c.image + c.n5 + c.image + c.n5;
    const star = systemStarOf(ctx.galaxy, h);
    const line1: RowSeg[] = [
        txt(h.name, 'bold'),
        txt(`(${(h.diameter / 10).toFixed(1)}K, ${star?.name ?? ''} system)`, 'small', ROW_TEXT, { gapBefore: c.n8 }),
    ];
    const approval = empireApprovalRating(ctx.galaxy, h);
    let face = approval > 15 ? 'happy.png' : approval > 0 ? 'neutral.png' : approval > -15 ? 'sad.png' : 'angry.png';
    if (h.rebelling) face = 'angry.png';
    const line2: RowSeg[] = [
        txt(fmtMillionsM(h.population?.totalAmount ?? 0), 'small', ROW_TEXT, { at: 0 }),
        ...img(chromeUrl('developmentLevel.png'), c.half, { at: c.n42, title: 'Development' }),
        txt(`${Math.round(habitatDevelopmentLevel(h))}%`, 'small', ROW_TEXT, { at: c.n55 }),
        ...img(chromeUrl(face), c.half, { at: c.n90, title: 'Happiness' }),
        txt(`GDP: ${fmtK(habitatAnnualRevenue(ctx.galaxy, h))}`, 'small', ROW_TEXT, { at: c.n111 }),
    ];
    // The first construction yard's ship under construction (ItemListPanel.cs 311-343).
    const q = queueOf(h as unknown as { constructionQueue: unknown });
    const first = q?.constructionYards?.[0]?.shipUnderConstruction ?? null;
    if (first) {
        line2.push(...img(shipImageUrl(first), c.n15, { at: c.n176, title: first.name }));
        line2.push(...img(chromeUrl('build.png'), c.n15, { at: c.n165, full: true }));
        const waiting = q?.constructionWaitQueue?.length ?? 0;
        // bitmap_72 (build.png) is drawn 15 px wide but the text follows its native 27 px width.
        if (waiting > 0) line2.push(txt(` (${waiting} waiting)`, 'small', ROW_TEXT, { at: c.n165 + 27 + 2 }));
    }
    if (deficient(h as unknown as { manufacturingQueue: unknown })) overlays.push({ url: STALLED_URL, x: 5, y: c.n20, size: c.half });
    return { pictures, overlays, textX, line1, line2, right: [] };
}

/** method_6, any other Habitat (the Potential … lists): status colour, quality / size, resources, bonuses, and the
 *  colonizing ship / base-to-build markers at the right. */
function locationRow(ctx: RowContext, h: Habitat, colonize: boolean, mining: boolean): ItemRowModel {
    const c = k(ctx);
    const pictures: RowPicture[] = [];
    let pic: string | null;
    if (h.category === HabitatCategoryType.GasCloud) pic = cloudUrls(h)[0] ?? null;
    else if (h.category === HabitatCategoryType.Star) pic = mapStarUrls(h)[0] ?? null;
    else pic = habitatImageUrl(h);
    if (pic) pictures.push({ url: pic, size: c.image, rotate: false, x: 5, y: 5 });
    const race = h.population?.dominantRace as Race | null | undefined;
    let textX = 5 + c.image + c.n5;
    if (race) {
        pictures.push({ url: racePortraitUrl(race.pictureIndex), size: c.image, rotate: false, x: 5 + c.image + c.n5, y: 5 });
        textX += c.image + c.n5;
    }
    const st = itemHabitatStatus(plannerStatusInput(ctx.galaxy, ctx.player, h, colonize), colonize, mining);
    let desc: string;
    if (st.reason !== '') desc = `(${st.reason})`;
    else if (h.category !== HabitatCategoryType.Star && h.category !== HabitatCategoryType.GasCloud) desc = `(Quality: ${pct(h.quality)}, ${systemStarOf(ctx.galaxy, h)?.name ?? ''} system)`;
    else desc = `(Size: ${(h.diameter / 10).toFixed(1)}K)`;
    const line1: RowSeg[] = [txt(h.name, 'bold', st.color), txt(desc, 'small', st.color, { gapBefore: c.n8 })];
    const line2: RowSeg[] = [];
    if (race) line2.push(txt(fmtMillionsM(h.population.totalAmount), 'small'));
    if (ctx.player.resourceMap?.checkResourcesKnown(h)) {
        const res = resourceSegs(ctx, h, c.half, 2);
        if (res.length > 0 && line2.length > 0) res[0] = { ...res[0], gapBefore: c.n15 };
        line2.push(...res);
    } else {
        line2.push(txt('(Unknown resources)', 'small', ROW_TEXT, { gapBefore: line2.length > 0 ? c.n15 : 0 }));
    }
    const bonus: string[] = [];
    if (h.researchBonus > 0 && h.researchBonusIndustry !== IndustryType.Undefined) {
        const ind = IndustryType[h.researchBonusIndustry] === 'HighTech' ? 'High Tech' : IndustryType[h.researchBonusIndustry];
        bonus.push(`${ind} Research: +${h.researchBonus}%`);
    }
    if (h.scenicFactor > 0) {
        bonus.push(h.scenicFeature ? `Scenery Bonus: +${pct(h.scenicFactor)} from ${h.scenicFeature}` : `Scenery Bonus: +${pct(h.scenicFactor)}`);
    }
    if (bonus.length > 0) line2.push(txt(bonus.join(', '), 'small', ROW_TEXT, { gapBefore: line2.length > 0 ? c.n10 : 0 }));
    const right: ItemRowModel['right'] = [];
    const colonizer = checkColonizingHabitat(ctx.player, h);
    if (colonizer) {
        const u = shipImageUrl(colonizer);
        if (u) right.push({ url: u, fromRight: c.n35 - c.n15, size: c.n15, y: c.n22 });
        right.push({ url: chromeUrl('colonize.png'), fromRight: c.n35, size: c.n15, y: c.n22 });
    } else {
        const design = checkBasesToBeBuiltAtHabitat(ctx.player, h)[0];
        if (design) {
            const u = builtObjectImageUrl(design.pictureRef);
            if (u) right.push({ url: u, fromRight: c.n35 - c.n15, size: c.n15, y: c.n22 });
            right.push({ url: chromeUrl('build.png'), fromRight: c.n35, size: c.n15, y: c.n22, full: true });
        }
    }
    return { pictures, overlays: [], textX, line1, line2, right };
}

/** method_6, BuiltObject. */
function builtObjectRow(ctx: RowContext, bo: BuiltObject): ItemRowModel {
    const c = k(ctx);
    const pictures: RowPicture[] = [];
    const overlays: ItemRowModel['overlays'] = [];
    const pic = shipImageUrl(bo);
    if (pic) pictures.push({ url: pic, size: c.image, rotate: true, x: 5, y: 5 });
    if ((bo.role === BuiltObjectRole.Base || bo.subRole === BuiltObjectSubRole.ConstructionShip) && deficient(bo)) {
        overlays.push({ url: STALLED_URL, x: 5, y: c.n20, size: c.half });
    }
    const textX = 5 + c.image + c.n3;
    const nameColor = bo.damagedComponentCount > 0 ? 0xff0000 : bo.unbuiltComponentCount > 0 ? 0xffa500 : ROW_TEXT;
    const line1: RowSeg[] = [txt(bo.name, 'bold', nameColor), txt(`(${resolveSubRoleDescription(bo.subRole)})`, 'small', ROW_TEXT, { gapBefore: c.n8 })];
    if (bo.role !== BuiltObjectRole.Base && bo.isAutoControlled) line1.push(...img(chromeUrl('automate.png'), c.half, { gapBefore: c.n8, title: 'Automated' }));
    const sg = bo.shipGroup as ShipGroup | null;
    if (sg) line1.push(txt(`(${sg.name ?? ''})`, 'small', ROW_TEXT, { gapBefore: c.n8 }));
    const line2: RowSeg[] = [];
    const mission = missionDescription(bo.mission as never, bo.empire);
    const fuel = (gap: number): RowSeg[] => [...img(chromeUrl('refuel.png'), c.half, { gapBefore: gap, title: 'Fuel' }), txt(fuelText(bo), 'small', ROW_TEXT, { gapBefore: 2 })];
    const firepower = (gap: number): RowSeg[] => [...img(chromeUrl('firepower.png'), c.half, { gapBefore: gap, title: 'Firepower' }), txt(String(bo.firepowerRaw), 'small')];
    // The build icon then each yard's ship: the first `first` px after the icon's left, the next `step` apart.
    const building = (gap: number, first: number, step: number): RowSeg[] => {
        const ships = yardShips(queueOf(bo));
        if (ships.length === 0) return [];
        const out: RowSeg[] = [...img(chromeUrl('build.png'), c.n15, { gapBefore: gap, full: true })];
        ships.forEach((s, i) => out.push(...img(shipImageUrl(s), c.n15, { gapBefore: (i === 0 ? first : step) - c.n15, title: s.name })));
        return out;
    };
    const isPort = bo.subRole === BuiltObjectSubRole.SmallSpacePort || bo.subRole === BuiltObjectSubRole.MediumSpacePort || bo.subRole === BuiltObjectSubRole.LargeSpacePort;
    if (isPort) {
        line2.push(...firepower(0));
        const b = building(c.n15, c.n16, c.n14);
        line2.push(...b);
        const waiting = queueOf(bo)?.constructionWaitQueue?.length ?? 0;
        if (b.length > 0 && waiting > 0) line2.push(txt(` (${waiting} waiting)`, 'small'));
    } else if (bo.subRole === BuiltObjectSubRole.ExplorationShip) {
        line2.push(txt(mission, 'small'), ...fuel(c.n15));
    } else if (bo.role === BuiltObjectRole.Military) {
        line2.push(txt(mission, 'small'), ...firepower(c.n10), ...fuel(c.n10));
        const troops = bo.troops?.items.filter((t) => t != null).length ?? 0;
        if (troops > 0) line2.push(...img(troopIconUrl(ctx), c.n15, { gapBefore: c.n10, title: 'Troops' }), txt(String(troops), 'small', ROW_TEXT, { gapBefore: 2 }));
        const fighters = (bo.fighters ?? []) as { pictureRef?: number }[];
        if (fighters.length > 0) {
            line2.push(...img(fighterImageUrl(fighters[0]?.pictureRef ?? -1), c.n15, { gapBefore: c.n10, title: 'Fighters' }), txt(String(fighters.length), 'small', ROW_TEXT, { gapBefore: 2 }));
        }
    } else if (bo.subRole === BuiltObjectSubRole.ConstructionShip) {
        line2.push(txt(mission, 'small', ROW_TEXT, { maxWidth: c.width }), ...fuel(c.n10), ...building(c.n15, c.n16, c.n16));
    } else if (bo.subRole === BuiltObjectSubRole.MiningStation || bo.subRole === BuiltObjectSubRole.GasMiningStation) {
        const h = bo.parentHabitat;
        if (h && h.resources.length > 0) {
            line2.push(txt('Mining:', 'small'));
            const res = resourceSegs({ ...ctx, player: { ...ctx.player, dominantRace: null } as Empire }, h, c.half, 2);
            if (res.length > 0) res[0] = { ...res[0], gapBefore: c.n5 };
            line2.push(...res);
        } else line2.push(txt('Mining: (None)', 'small'));
    } else if (bo.role === BuiltObjectRole.Base) {
        line2.push(...firepower(0));
    } else {
        line2.push(txt(mission, 'small'), ...fuel(c.n15));
    }
    return { pictures, overlays, textX, line1, line2, right: [] };
}

/** method_6, ShipGroup. */
function shipGroupRow(ctx: RowContext, sg: ShipGroup): ItemRowModel {
    const c = k(ctx);
    const pictures: RowPicture[] = [];
    const lead = sg.leadShip;
    const pic = lead ? shipImageUrl(lead) : null;
    if (pic) pictures.push({ url: pic, size: c.image, rotate: true, x: 5, y: 5 });
    const textX = 5 + c.image + c.n3;
    const ships = sg.ships.filter((s) => s != null);
    const line1: RowSeg[] = [txt(sg.name ?? '', 'bold'), txt(`(${ships.length} ships)`, 'small', ROW_TEXT, { gapBefore: c.n12 })];
    if (lead?.isAutoControlled) line1.push(...img(chromeUrl('automate.png'), c.half, { gapBefore: c.n10, title: 'Automated' }));
    let firepower = 0;
    let troops = 0;
    let fighters = 0;
    let fighterRef = -1;
    for (const s of ships) {
        firepower += s.firepowerRaw;
        troops += s.troops?.items.filter((t) => t != null).length ?? 0;
        const f = (s.fighters ?? []) as { pictureRef?: number }[];
        fighters += f.length;
        if (fighterRef < 0 && f.length > 0) fighterRef = f[0]?.pictureRef ?? -1;
    }
    const line2: RowSeg[] = [
        txt(missionDescription(sg.mission, sg.empire), 'small'),
        ...img(chromeUrl('firepower.png'), c.half, { gapBefore: c.n15, title: 'Firepower' }),
        txt(String(firepower), 'small'),
    ];
    if (troops > 0) line2.push(...img(troopIconUrl(ctx), c.n15, { gapBefore: c.n10, title: 'Troops' }), txt(String(troops), 'small', ROW_TEXT, { gapBefore: 2 }));
    if (fighters > 0) line2.push(...img(fighterImageUrl(fighterRef), c.n15, { gapBefore: c.n10, title: 'Fighters' }), txt(String(fighters), 'small', ROW_TEXT, { gapBefore: 2 }));
    const right: ItemRowModel['right'] = [];
    if (sg.posture === FleetPosture.Attack) right.push({ url: chromeUrl('fleetAttackPosture.png'), fromRight: c.n40, size: c.half, y: c.n4 });
    else if (sg.posture === FleetPosture.Defend) right.push({ url: chromeUrl('fleetDefendPosture.png'), fromRight: c.n40, size: c.half, y: c.n4 });
    const r2 = sg.postureRangeSquared;
    const range = r2 <= 2250000 ? 'fleetRangeTarget.png' : r2 <= 2304000000 ? 'fleetRangeSystem.png' : r2 <= 250000000000 ? 'fleetRangeArea.png' : r2 <= 1000000000000 ? 'fleetRangeSector.png' : 'fleetRangeAny.png';
    right.push({ url: chromeUrl(range), fromRight: c.n20, size: c.half, y: c.n4 });
    return { pictures, overlays: [], textX, line1, line2, right };
}

/** method_6, Character (race portrait instead of the character picture — no character art). */
function characterRow(ctx: RowContext, ch: Character): ItemRowModel {
    const c = k(ctx);
    const pictures: RowPicture[] = [];
    if (ch.race) pictures.push({ url: racePortraitUrl(ch.race.pictureIndex), size: c.image, rotate: false, x: 5, y: 5 });
    const textX = 5 + c.n38 + c.n5;
    let task = resolveDescriptionCharacterTask(ch, ctx.galaxy);
    if (task === '' && ch.location) {
        task = (ch.location as { name: string }).name;
        const sg = (ch.location as { shipGroup?: ShipGroup | null }).shipGroup;
        if (sg) task += `  (${sg.name ?? ''})`;
    }
    return {
        pictures,
        overlays: [],
        textX,
        line1: [txt(ch.name, 'bold'), txt(`(${resolveRoleDescription(ch.role)})`, 'small', ROW_TEXT, { gapBefore: c.n8 })],
        line2: [txt(task, 'small')],
        right: [],
    };
}

/** method_6, GalaxyLocation (Special Locations). */
function galaxyLocationRow(ctx: RowContext, loc: GalaxyLocation): ItemRowModel {
    const c = k(ctx);
    const related = (loc as { relatedBuiltObject?: BuiltObject | null }).relatedBuiltObject ?? null;
    const label = loc.type === GalaxyLocationType.RestrictedArea ? 'Restricted Area' : loc.type === GalaxyLocationType.PlanetDestroyer ? 'Planet Destroyer Project' : 'Debris Field';
    const pictures: RowPicture[] = [];
    let textX = 5;
    if (related) {
        const u = builtObjectImageUrl(resolveDrawPictureRef(related));
        if (u) {
            pictures.push({ url: u, size: c.image, rotate: true, x: 5, y: 5 });
            textX += c.image + c.n5;
        }
    }
    const empire = related?.empire ?? null;
    const color = empire && empire.pirateEmpireBaseHabitat === null && empire !== ctx.galaxy.independentEmpire ? empire.mainColor : ROW_TEXT;
    let where = '';
    let best: Habitat | null = null;
    let bestD = Infinity;
    for (const s of ctx.galaxy.systems) {
        const d = (s.systemStar.xpos - loc.xpos) ** 2 + (s.systemStar.ypos - loc.ypos) ** 2;
        if (d < bestD) {
            bestD = d;
            best = s.systemStar;
        }
    }
    if (best) where = `Near ${best.name}, `;
    where += `Sector ${resolveSectorDescription(ctx.galaxy, loc.xpos, loc.ypos)}`;
    return {
        pictures,
        overlays: [],
        textX,
        line1: [txt(loc.name, 'bold', color), txt(`(${label})`, 'small', color, { gapBefore: c.n8 })],
        line2: [txt(where, 'small')],
        right: [],
    };
}

/** Port of ItemListPanel.cs method_6: the row model of one item of panel `id`. */
export function itemRowModel(ctx: RowContext, id: ItemPanelId, item: PanelItem): ItemRowModel {
    if (item instanceof ShipGroup) return shipGroupRow(ctx, item);
    if (item instanceof Habitat) {
        const owned = item.owner != null && item.owner !== ctx.galaxy.independentEmpire && (item.population?.totalAmount ?? 0) > 0;
        if (owned) return colonyRow(ctx, item);
        return locationRow(ctx, item, id === 'potentialColonies', id === 'potentialMining');
    }
    if (item instanceof BuiltObject) return builtObjectRow(ctx, item);
    if (item instanceof GalaxyLocation) return galaxyLocationRow(ctx, item);
    return characterRow(ctx, item);
}

// ---------------------------------------------------------------------------------------------------------------
// Clicks (Main.Part12.cs method_78)
// ---------------------------------------------------------------------------------------------------------------

/** What a click on an item does: the object to select (method_208) and whether to move the view + zoom (a double
 *  click: method_157 + method_4(1.0)). A Character selects its location; a GalaxyLocation its related object. */
export function itemClickTarget(item: PanelItem): { select: Habitat | BuiltObject | ShipGroup | null; centre: { x: number; y: number } | null } {
    if (item instanceof ShipGroup) return { select: item, centre: item.leadShip ? { x: item.leadShip.xpos, y: item.leadShip.ypos } : null };
    if (item instanceof Habitat) return { select: item, centre: { x: item.xpos, y: item.ypos } };
    if (item instanceof BuiltObject) return { select: item, centre: { x: item.xpos, y: item.ypos } };
    if (item instanceof GalaxyLocation) {
        const related = (item as { relatedBuiltObject?: BuiltObject | null }).relatedBuiltObject ?? null;
        return { select: related, centre: { x: item.xpos, y: item.ypos } };
    }
    const at = item.location as (Habitat | BuiltObject | null);
    return { select: at ?? null, centre: at ? { x: at.xpos, y: at.ypos } : null };
}

/** Port of method_78's Shift branch: toggle `bo` in the current multi-selection. `current` is the selection's ship
 *  list (BuiltObjectList), or the single selected ship. Returns the new list (empty → clear the selection). Only the
 *  player's own non-base ships join (method_140). */
export function shiftToggleSelection(current: readonly BuiltObject[] | BuiltObject | null, bo: BuiltObject, player: Empire): BuiltObject[] | null {
    const canJoin = (b: BuiltObject): boolean => b.empire === player && b.role !== BuiltObjectRole.Base;
    if (!canJoin(bo)) return null;
    if (Array.isArray(current)) {
        const out = current.slice();
        const i = out.indexOf(bo);
        if (i >= 0) out.splice(i, 1);
        else out.push(bo);
        return out;
    }
    if (current && !Array.isArray(current) && canJoin(current as BuiltObject)) {
        return current === bo ? [] : [current as BuiltObject, bo];
    }
    return [bo];
}
