// Selection info panel content model: a port of the original's InfoPanel drawing (DistantWorlds.Controls/Controls/
// InfoPanel.cs DrawHabitat / DrawSystemInfo / DrawCreature / DrawBuiltObjectSelection and BaconDistantWorlds/
// BaconInfoPanel.cs DrawBuiltObject / DrawShipGroup) as data. Pure (no DOM): the builders read the sim and return the
// rows the panel draws, in the original's order, with its labels, colours and bar graphs; selectionInfoView.ts turns
// the model into DOM. Geometry is in the original's small-content-size pixels (InfoPanel.SetContentSizeNormal:
// _RowHeight 15, _ImageSize 14, _LabelWidth 65 / _LabelWidthHabitat 70, ...); the frame scales the whole panel.
//
// The builders only read the sim (no galaxy.rnd, no caches written): they run every 500 ms while something is
// selected.

import type { Ruin } from '../sim/ruins';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { BuiltObject } from '../sim/builtObject';
import { BuiltObjectSubRole } from '../sim/builtObjectTypes';
import { componentListDiff } from '../sim/construction/constructionYard';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import { BuiltObjectMissionType, COORD_UNSET_DOUBLE, builtObjectMission, type BuiltObjectMission } from '../sim/missions/mission';
import { ShipGroup } from '../sim/fleets/shipGroup';
import { Habitat, HabitatCategoryType, HabitatType, IndustryType, type SystemInfo } from '../sim/types';
import { SystemVisibilityStatus } from '../sim/visibility';
import type { Troop, TroopList } from '../sim/cargo';
import type { Race } from '../sim/data/races';
import type { Creature } from '../sim/creature';
import { resolveCreatureDescription } from '../sim/creature';
import { resolveSubRoleDescription } from '../sim/designGeneration';
import { strategicValue } from '../sim/territory';
import { habitatDevelopmentLevel } from '../sim/developmentLevel';
import { empireApprovalRating, taxComplianceRate } from '../sim/taxes';
import { habitatAnnualRevenue, habitatCorruption, privateAnnualRevenue, calculateAccurateAnnualIncome } from '../sim/forceStructure';
import { canEmpireColonizeHabitatExplained } from '../sim/player/advisorSuggestions';
import { checkColonizationLikeliness } from '../sim/tradeItems';
import { checkBasesToBeBuiltAtHabitat, checkColonizingHabitat } from '../sim/civilianAI';
import { checkSystemOwnership } from '../sim/stationPlacement';
import { blockadeFor } from '../sim/fleets/blockades';
import { galaxyPlagues } from '../sim/eventTypes';
import { calculateAvailableAssaultPodAttackStrength } from '../sim/combat/attackAI';
import { shipGroupTotalTroopCapacity, shipGroupTotalTroopSpaceUsed } from '../sim/fleets/shipGroupTasks';
import { troopCountsByType, troopCompositionDescription } from './screens/troops';
import { fleetPostureDescription, fleetTotalFirepower } from './screens/fleetsList';
import { fleetRefillStatus } from '../sim/player/fleetRefill';
import { fleetTemplateSummary } from './fleetRefillControls';
import { yardProgress } from './screens/constructionYards';
import type { ConstructionQueue } from '../sim/construction/constructionQueue';
import { builtObjectImageUrl, resolveDrawPictureRef } from '../render/builtObjectLayer';
import { fighterImageUrl } from '../render/fighterLayer';
import { FighterMissionType, Fighter, captainFightersBonus } from '../sim/combat/fighters';
import { CharacterRole, CharacterSkillType } from '../sim/characters';
import { builtObjectCharacterBonusDescription, fmtPlusMinusPct, shipGroupCharacterBonusDescription } from './characterBonusText';
import { CHARACTER_ROLE, CHARACTER_SKILL, resolveEnumTextDescription } from '../sim/enumText';
import { cloudUrls, habitatPictureUrl, mapStarUrls, starPictureUrls } from '../render/assets';
import { racePortraitUrl } from './empireEmblem';
import { abundancePercentText } from './resourceAbundance';
import { habitatTypeLabel, hyperjumpStatusText, invasionVsText, missionTargetText, missionTypeLabel, resourceIconUrl, threatRows, troopStrengthText } from './hud';
import { wreckSalvageRows } from './scenario/wreckageUi'; // [wreckage]
import { rimGoodMarker } from './scenario/rimTraderRows'; // [rimTrader]
import { facilityGalactopediaTopic, facilityPanelHoverText } from './facilityHover';
import { supplyChainEnabled, supplySnapshot } from './supplyChainCache'; // [improvements] supplyChain
import { colonyTooltipLines, itemNeedsText, resourceName, siteTooltipLines } from './supplyChainText'; // [improvements] supplyChain
import { isPrivateer } from '../sim/scenario/privateers/privateers'; // privateers add-on label

// ---------------------------------------------------------------------------------------------------------------
// Metrics (InfoPanel.cs SetContentSizeNormal 2420-2447) and colours (InfoPanel.cs fields / BaconInfoPanel.cs).
// ---------------------------------------------------------------------------------------------------------------

export const INFO = {
    /** pnlDetailInfo client size (Main.Part12.cs 1962 Size(280, 240)). */
    width: 280,
    height: 240,
    rowHeight: 15,
    imageSize: 14,
    habitatImageSize: 26,
    flagSmall: { w: 30, h: 18 },
    flagSystem: { w: 20, h: 12 },
    minPictureSize: 60,
    maxPictureSize: 200,
    populationTextWidth: 75,
    populationAmountWidth: 48,
    labelWidth: 65,
    labelWidthHabitat: 70,
    colonySummaryDetailWidth: 20,
} as const;

/** CSS colour of a packed 0xRRGGBB (alpha optional, 0..255 like Color.FromArgb). */
export function css(rgb: number, alpha = 255): string {
    const r = (rgb >> 16) & 255;
    const g = (rgb >> 8) & 255;
    const b = rgb & 255;
    return alpha >= 255 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${+(alpha / 255).toFixed(3)})`;
}

/** InfoPanel._WhiteColor / _WhiteBrush = Color.FromArgb(200, 200, 200): the panel's "white" text. */
export const WHITE = 0xc8c8c8;
/** InfoPanel._UnknownColor = Color.FromArgb(96, 96, 96). */
export const UNKNOWN_COLOR = 0x606060;
/** InfoPanel._PirateColor = Color.FromArgb(80, 80, 80). */
export const PIRATE_COLOR = 0x505050;
/** InfoPanel._IndependentColor = Color.FromArgb(160, 160, 160). */
export const INDEPENDENT_COLOR = 0xa0a0a0;
/** BaconInfoPanel.cs DrawBarGraph default fill: (150,48,0,96) → (150,128,0,255). */
export const BAR_FILL: readonly [string, string] = [css(0x300060, 150), css(0x8000ff, 150)];
/** Low fuel (< 1/3): (150,128,0,40) → (150,255,0,96). */
export const BAR_FILL_LOW: readonly [string, string] = [css(0x800028, 150), css(0xff0060, 150)];
/** HyperjumpPrepare / Super Laser charging alternate: (150,144,80,80) → (150,255,160,160). */
export const BAR_FILL_ALT: readonly [string, string] = [css(0x905050, 150), css(0xffa0a0, 150)];
/** The bar's empty part: Color.FromArgb(127, 8, 8, 48). */
export const BAR_BACKGROUND = css(0x080830, 127);

/** Galaxy.cs DetermineContrastDropShadowColor(color) with the (White, Black) defaults; InfoPanel.CheckDropshadowColor
 *  returns black for the pirate / unknown greys. */
export function dropShadowColor(rgb: number): number {
    if (rgb === PIRATE_COLOR || rgb === UNKNOWN_COLOR) return 0x000000;
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;
    const num = 1.0 - (0.333 * r + 0.333 * g + 0.333 * b) / 255.0;
    return num < 0.7 ? 0x000000 : 0xffffff;
}

// ---------------------------------------------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------------------------------------------

/** What a hotspot (InfoPanel.AddHotspot) does on click. */
export type InfoTarget =
    | { kind: 'select'; obj: Habitat | BuiltObject | ShipGroup | Fighter }
    | { kind: 'empire'; empire: Empire }
    /** A ruin hotspot (InfoPanel.cs 4093 / 4263, "Name (click for details)"): Main.Part4.cs 3581 → method_550. */
    | { kind: 'ruin'; ruin: Ruin }
    /** InfoPanel.cs 4461 / 4497 `AddHotspot(..., new object[1] { habitat }, ...)`: the Ground / Battle Report
     *  (Main.Part4.cs:3534 pnlDetailInfo_MouseClick → method_164(habitat), screens/groundReport.ts). */
    | { kind: 'groundReport'; habitat: Habitat }
    /** A planetary facility hotspot (InfoPanel.cs 2604): Main.Part4.cs 3586-3597 → method_456, the Galactopedia at the
     *  "Wonders" or "Planetary Facilities" topic. */
    | { kind: 'galactopedia'; topic: string }
    /** [improvements] supplyChain: the Waiting row → the Construction Yards screen's Waiting For tab at this site. */
    | { kind: 'supply'; target: Habitat | BuiltObject }
    /** Not in the original: the player's fleet's "Template" row (fleetRefill.ts) opens the Fleets screen on the fleet,
     *  where its template, auto-refill and Replenish are. */
    | { kind: 'fleetTemplate'; fleet: ShipGroup };
// (The same target serves the resource and race hotspots: Main.Part4.cs 3598-3607, method_456(resource / race Name).)

/** One run of a row: text, an image, an empire flag, or a troop icon. */
export interface InfoSeg {
    text?: string;
    /** Packed RGB text colour (default white). */
    color?: number;
    /** _TinyFont (resource %, planet type abbreviations). */
    tiny?: boolean;
    img?: string;
    /** Image size in panel px (default _ImageSize square). */
    w?: number;
    h?: number;
    /** Rotate the image (ship icons in build buttons / grids are drawn as-is; kept for ship pictures). */
    faded?: boolean;
    /** Background behind the image (damaged / under construction / garrisoned chips). */
    bg?: string;
    /** Draw this empire's flag (stock or scenario emblem) at w×h. */
    flagOf?: Empire;
    /** A troop icon (troopImageUrl + fallback chain); `state` picks the chip. */
    troop?: Troop;
    troopState?: 'garrison' | 'recruit' | 'invade' | '';
    /** Gap before this segment, panel px. */
    gap?: number;
    /** Fixed width (population columns). */
    width?: number;
    title?: string;
    target?: InfoTarget;
}

export type InfoRow =
    /** A full-width line from the left margin (mission, description, alerts). */
    | { kind: 'line'; segs: InfoSeg[]; wrap?: boolean; alert?: boolean; title?: string; target?: InfoTarget }
    /** DrawLabelledDescription / DrawLabel + content: a right-aligned bold label, then the segments. `strip` draws the
     *  dark (190,24,24,32) strip behind the content (resources / facilities / fighters / population). */
    | { kind: 'row'; label: string; segs: InfoSeg[]; strip?: boolean; wrap?: boolean; alert?: boolean; title?: string; target?: InfoTarget; height?: number }
    /** DrawBarGraph. */
    | { kind: 'bar'; label: string; max: number; current: number; inner: string; right: string; fill: readonly [string, string]; alt?: readonly [string, string] }
    | { kind: 'gap'; h: number }
    /** The label-area brush (63,127,32,32) starts at this row and runs to the panel bottom. */
    | { kind: 'band' }
    /** DrawSystemColoniesSummary. */
    | { kind: 'colonies'; items: ColonySummaryItem[]; more: boolean }
    /** DrawShipGroup / DrawBuiltObjectSelection ship image grid (27 px cells, a green fuel bar on the right). */
    | { kind: 'grid'; indent: number; cells: ShipCell[] };

export interface ColonySummaryItem {
    habitat: Habitat;
    img: string | null;
    abbr: string;
    flagOf: Empire | null;
    raceImg: string | null;
    race: Race | null;
    /** DrawPopulationIndicator 5×5 grid: lit columns (population) × rows (development). */
    pop: number;
    dev: number;
    base: BuiltObject | null;
    baseImg: string | null;
    resourceImg: string | null;
    resourceTitle: string;
    /** The resource's Galactopedia topic (its name), null without a resource icon. */
    resourceTopic: string | null;
    /** "?" when the base's resources are unknown. */
    resourceUnknown: boolean;
}

export interface ShipCell {
    ship: BuiltObject;
    img: string | null;
    /** Picture side within the 27 px cell: min(sqrt(size)*1.25, 27). */
    side: number;
    bg: string | null;
    fuel: number | null;
    title: string;
    clickable: boolean;
}

export interface InfoPicture {
    url: string;
    /** Picture box size in panel px (the C#'s _PictureSize after the min/max clamp and fit). */
    size: number;
    /** CSS rotation, degrees. */
    rotate: number;
    /** FadeImage alpha (0.33 for objects, 0.6 for the generic picture). */
    alpha: number;
    /** Stars: shifted left by 55% of the picture (DrawBackgroundPicture). */
    star: boolean;
}

export interface InfoModel {
    /** The title line (title font), e.g. the name in the empire colour and "(Empire)" in the normal font. */
    title: InfoSeg[];
    /** Top-right corner: the empire flag (hotspot) or a text ("Independent"). */
    corner: { flagOf?: Empire; text?: string; color?: number; target?: InfoTarget } | null;
    picture: InfoPicture | null;
    rows: InfoRow[];
    /** Label column width (right-aligned labels end here, the content starts 10 px later). */
    labelWidth: number;
    /** _AutomateImage at the bottom right (the player's automated ship / fleet). */
    automated: boolean;
}

export interface InfoContext {
    galaxy: Galaxy;
    player: Empire;
    /** resources.txt id → { name, pictureRef } (gameData.resources). */
    resource: (id: number) => { name: string; pictureRef: number } | null;
}

// ---------------------------------------------------------------------------------------------------------------
// Formatting (.NET custom numeric formats the panel uses)
// ---------------------------------------------------------------------------------------------------------------

/** value.ToString("0,K"): thousands, rounded, "K" suffix. */
export function fmtK(v: number): string {
    return `${Math.round(v / 1000)}K`;
}

/** BaconInfoPanel.FormatForLargeNumbers: below a million as is, else "0,," millions + "M". */
export function fmtLarge(v: number): string {
    return v < 1000000 ? String(Math.trunc(v)) : `${Math.round(v / 1000000)}M`;
}

/** ToString("0%"). */
export function fmtPct(f: number): string {
    return `${Math.round(f * 100)}%`;
}

/** ToString("+#0%;-#0%;0%") / ("+0%"). */
export function fmtSignedPct(f: number): string {
    const p = Math.round(f * 100);
    return p > 0 ? `+${p}%` : p < 0 ? `-${-p}%` : '0%';
}

/** ToString("+###;-###;0"). */
function fmtSigned(v: number): string {
    const p = Math.round(v);
    return p > 0 ? `+${p}` : p < 0 ? `-${-p}` : '0';
}

// ---------------------------------------------------------------------------------------------------------------
// Image URLs
// ---------------------------------------------------------------------------------------------------------------

const CHROME = '/assets/dwu/images/ui/chrome';
export const chromeUrl = (file: string): string => `${CHROME}/${file}`;

/** InfoPanel _FacilityImages[pictureRef] (environment/planetaryfacilities/facility_<n>.png, Main.Part13.cs 1736). */
export function facilityImageUrl(pictureRef: number): string {
    return `/assets/dwu/images/environment/planetaryfacilities/facility_${pictureRef}.png`;
}

/** The small picture of a habitat (habitatImageCache GetImagesSmall): the planet / moon / asteroid / cloud sprite, a
 *  star's map picture bitmap_196[MapPictureRef] (ItemListPanel.cs 951; a super nova's too). Null without art. */
export function habitatImageUrl(h: Habitat): string | null {
    switch (h.category) {
        case HabitatCategoryType.Star:
            return mapStarUrls(h)[0] ?? null;
        case HabitatCategoryType.GasCloud:
            return cloudUrls(h)[0] ?? null;
        default:
            // Planets, moons, asteroids: HabitatImageCache[habitat.PictureRef].
            return habitatPictureUrl(h.pictureRef);
    }
}

export function shipImageUrl(bo: BuiltObject): string | null {
    return builtObjectImageUrl(resolveDrawPictureRef(bo));
}

function raceImageUrl(race: Race | null | undefined): string | null {
    return race != null ? racePortraitUrl(race.pictureIndex) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------------------------

/** InfoPanel.SetEmpirePictureAndColor: the title colour of an empire. */
export function empireTitleColor(galaxy: Galaxy, empire: Empire | null): number {
    if (empire === null) return WHITE;
    if (empire === galaxy.independentEmpire) return INDEPENDENT_COLOR;
    if (empire.pirateEmpireBaseHabitat !== null && empire.mainColor === 0x010101) return PIRATE_COLOR;
    return empire.mainColor;
}

function label(text: string, segs: InfoSeg[], extra: Partial<Extract<InfoRow, { kind: 'row' }>> = {}): InfoRow {
    return { kind: 'row', label: text, segs, ...extra };
}

function txt(text: string, color?: number): InfoSeg {
    return color === undefined ? { text } : { text, color };
}

/** Galaxy.ResolveDescription(HabitatCategoryType). */
export function categoryLabel(c: HabitatCategoryType): string {
    switch (c) {
        case HabitatCategoryType.Star: return 'Star';
        case HabitatCategoryType.Planet: return 'Planet';
        case HabitatCategoryType.Moon: return 'Moon';
        case HabitatCategoryType.Asteroid: return 'Asteroid';
        default: return 'Gas Cloud';
    }
}

/** Galaxy.ResolveDescription(IndustryType). */
function industryLabel(i: IndustryType): string {
    const k = IndustryType[i] ?? '';
    return k === 'HighTech' ? 'High Tech' : k;
}

/** Galaxy.ResolveDescription(empire, mission): "<type> <target>" (the target part of Galaxy.3.cs ResolveDescription). */
export function missionDescription(mission: BuiltObjectMission | null, empire: Empire | null): string {
    if (mission === null || mission.type === BuiltObjectMissionType.Undefined) return '(No mission)';
    const t = missionTargetText(mission, empire);
    const type = missionTypeLabel(mission.type);
    return t !== '' ? `${type} ${t}` : type;
}

/** The engagement-range suffix (BaconInfoPanel.cs:334 / 275). */
export function engageSuffix(attackRangeSquared: number): string {
    if (attackRangeSquared === 0) return ' (Engage when attacked)';
    if (attackRangeSquared === 4000000) return ' (Engage nearby targets)';
    if (attackRangeSquared === 2304000000) return ' (Engage system targets)';
    return ' (Engage detected targets)';
}

function troopItems(list: TroopList | null): Troop[] {
    return list !== null ? list.items.filter((t): t is Troop => t != null) : [];
}

/** InfoPanel.cs 2614 DrawTroopsAgents (troop icons; characters are not drawn: no character art here). */
function troopSegs(troops: Troop[], recruiting: Troop[], invading: Troop[]): InfoSeg[] {
    const segs: InfoSeg[] = [];
    for (const t of recruiting) segs.push({ troop: t, troopState: 'recruit', title: `Recruiting ${t.name}` });
    for (const t of troops) segs.push({ troop: t, troopState: t.garrisoned ? 'garrison' : '', title: t.name });
    for (const t of invading) segs.push({ troop: t, troopState: 'invade', title: `Invading ${t.name}` });
    return segs;
}

/** InfoPanel.cs 3240 DrawBuiltObjectList: ship icons (damaged red-ish / under construction orange chips), then
 *  "N waiting" and a suffix. */
function builtObjectListSegs(ctx: InfoContext, ships: BuiltObject[], waiting: number, suffix: string): InfoSeg[] {
    const segs: InfoSeg[] = [];
    if (ships.length === 0) segs.push(txt('(None)'));
    for (const bo of ships) {
        const own = bo.actualEmpire === ctx.player;
        let bg: string | undefined;
        let state = '';
        if (bo.damagedComponentCount > 0) {
            if (own) bg = css(0xff0040, 64);
        } else if (bo.unbuiltComponentCount > 0 && own) {
            bg = css(0xff8000, 64);
            state = 'Under construction';
        }
        const img = shipImageUrl(bo);
        segs.push({
            img: img ?? undefined,
            bg,
            title: state !== '' ? `${bo.name} (${state} - click to select)` : `${bo.name} (click to select)`,
            target: { kind: 'select', obj: bo },
        });
    }
    if (waiting > 0) segs.push({ text: `${waiting} waiting`, gap: INFO.imageSize / 2 });
    if (suffix !== '') segs.push({ text: suffix, gap: 10 });
    return segs;
}

/** The construction yards' ships under construction + the wait queue (InfoPanel.cs 3480-3495 / BaconInfoPanel 181). */
function buildingRow(ctx: InfoContext, queue: ConstructionQueue | null): InfoRow | null {
    if (queue === null || (queue.constructionYards?.length ?? 0) === 0) return null;
    const ships: BuiltObject[] = [];
    const pct: string[] = [];
    for (const yard of queue.constructionYards ?? []) {
        if (yard?.shipUnderConstruction == null) continue;
        ships.push(yard.shipUnderConstruction);
        pct.push(`${yard.shipUnderConstruction.name} ${Math.round(yardProgress(yard) * 100)}%`);
    }
    const segs = builtObjectListSegs(ctx, ships, queue.constructionWaitQueue?.length ?? 0, '');
    // Streamlined: each ship's percent complete in its hover text (the original only shows it in the yards window).
    for (let i = 0, j = 0; i < segs.length; i++) {
        if (segs[i].target !== undefined && j < pct.length) segs[i].title = `${pct[j++]} (click to select)`;
    }
    return label('Building', segs);
}

// [improvements] supplyChain begin
/** What the site's queued ships wait for (the player's own yards; ui/supplyChainCache.ts snapshot, ≤ 1 s old): one line
 *  per short ship (at most 3), red when stalled or nothing is coming; the hover lists every resource, a click opens the
 *  Construction Yards screen's Waiting For tab. */
function waitingRows(ctx: InfoContext, target: Habitat | BuiltObject): InfoRow[] {
    if (!supplyChainEnabled()) return [];
    const site = supplySnapshot(ctx.galaxy, ctx.player)?.bySite.get(target);
    if (site === undefined || site.resources.length === 0) return [];
    const items = site.items.filter((i) => i.needs.length > 0);
    const title = `${siteTooltipLines(ctx.galaxy, site, ctx.player, 8).join('\n')}\n(click: Construction Yards → Waiting For)`;
    const goTo: InfoTarget = { kind: 'supply', target };
    const rows: InfoRow[] = [];
    items.slice(0, 3).forEach((it, i) => {
        const bad = it.stalled || it.needs.some((n) => n.uncovered > 0);
        rows.push(label(i === 0 ? 'Waiting' : '', [txt(`${it.ship.name}: ${itemNeedsText(ctx.galaxy, it, 2)}`, bad ? SUPPLY_ALERT : SUPPLY_SHORT)], { wrap: true, alert: bad, title, target: goTo }));
    });
    if (items.length > 3) rows.push(label('', [txt(`+${items.length - 3} more ships short of resources`, SUPPLY_SHORT)], { title, target: goTo }));
    return rows;
}

/** A player colony short of luxuries: its luxury count against what development needs, and what is not coming. */
function luxuryRow(ctx: InfoContext, h: Habitat): InfoRow | null {
    if (!supplyChainEnabled()) return null;
    const c = supplySnapshot(ctx.galaxy, ctx.player)?.byColony.get(h);
    if (c === undefined || !c.short) return null;
    const notComing = c.demanded.filter((d) => d.notComing).map((d) => resourceName(ctx.galaxy, d.resourceId));
    const head = c.developmentFalling ? `${c.luxuryTypes} of ${c.typesForDevelopment} types: development falling` : `${c.luxuryTypes} types (wants ${c.typesWanted})`;
    const tail = notComing.length > 0 ? `; not coming: ${notComing.slice(0, 2).join(', ')}${notComing.length > 2 ? ` +${notComing.length - 2}` : ''}` : '';
    return label('Luxuries', [txt(`${head}${tail}`, c.developmentFalling ? SUPPLY_ALERT : SUPPLY_SHORT)], { wrap: true, alert: c.developmentFalling, title: colonyTooltipLines(ctx.galaxy, c, ctx.player, 8).join('\n') });
}
/** Text colours of those rows (the overlay's red / amber). */
const SUPPLY_ALERT = 0xff6a50;
const SUPPLY_SHORT = 0xffc040;
// [improvements] supplyChain end

function dockedRow(ctx: InfoContext, bays: { dockedShip: BuiltObject | null }[] | null, waitQueue: BuiltObject[] | null): InfoRow | null {
    if (bays === null || bays.length === 0) return null;
    const ships = bays.map((b) => b.dockedShip).filter((s): s is BuiltObject => s !== null);
    return label('Docked', builtObjectListSegs(ctx, ships, waitQueue?.length ?? 0, ''));
}

function systemVisibility(ctx: InfoContext, systemIndex: number): SystemVisibilityStatus {
    const vis = ctx.player.visibility;
    if (systemIndex < 0 || systemIndex >= vis.systemVisibility.length) return SystemVisibilityStatus.Unexplored;
    return vis.checkSystemVisibilityStatus(systemIndex);
}

function resourcesKnown(ctx: InfoContext, h: Habitat): boolean {
    const map = ctx.player.resourceMap;
    return map != null && map.checkResourcesKnown(h);
}

/** InfoPanel.cs 3198 DrawResources: icon + tiny "abundance%" per resource on the dark strip. Each icon is a resource
 *  hotspot (the abundance stays the tiny text after it, not in the hover message). */
function resourceSegs(ctx: InfoContext, resources: { resourceId: number; abundance: number }[], color: number): InfoSeg[] {
    if (resources.length === 0) return [txt('(None)', color)];
    const segs: InfoSeg[] = [];
    for (const r of resources) {
        const def = ctx.resource(r.resourceId);
        const name = def?.name ?? `Resource ${r.resourceId}`;
        const rimMark = rimGoodMarker(ctx.galaxy, r.resourceId); // [rimTrader]
        const pct = abundancePercentText(r.abundance) + (rimMark !== '' ? ` ${rimMark}` : '');
        // 3226: the icon is a hotspot, "Name (click for details)"; a click opens the Galactopedia on the resource's
        // page (Main.Part4.cs 3598 → method_456(resource.Name)).
        segs.push({ img: def ? resourceIconUrl(def.pictureRef) : undefined, title: `${name} (click for details)`, target: { kind: 'galactopedia', topic: name }, gap: segs.length > 0 ? 3 : 0 });
        segs.push({ text: pct, tiny: true, color, gap: -2 });
    }
    return segs;
}

/** InfoPanel.cs 2552 DrawFacilities: facility icons (faded while under construction) on the dark strip. Each icon is a
 *  hotspot (AddHotspot(rect, planetaryFacility, text), 2575-2604): its hover message is facilityPanelHoverText and a
 *  click opens the Galactopedia at "Wonders" / "Planetary Facilities" (Main.Part4.cs 3586 pnlDetailInfo_MouseClick). */
function facilitySegs(galaxy: Galaxy, h: Habitat): InfoSeg[] {
    const list = (h.facilities ?? []).filter((f) => f != null);
    if (list.length === 0) return [txt('(None)')];
    return list.map((f, i) => ({
        img: facilityImageUrl(f.def.pictureRef),
        faded: f.constructionProgress < 1,
        gap: i > 0 ? 2 : 0,
        title: facilityPanelHoverText(galaxy, h, f),
        target: { kind: 'galactopedia', topic: facilityGalactopediaTopic(f) },
    }));
}

/** The picture behind the rows: InfoPanel.SetData's _PictureSize (min 60, max 200 px) and FadeImage(0.33). */
function picture(url: string | null, size: number, rotate = 0, star = false): InfoPicture | null {
    if (url === null) return null;
    return { url, size: Math.max(INFO.minPictureSize, Math.min(INFO.maxPictureSize, Math.trunc(size))), rotate, alpha: 0.33, star };
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObject (BaconInfoPanel.cs 177 DrawBuiltObject)
// ---------------------------------------------------------------------------------------------------------------

/** The object's empire as the panel shows it (InfoPanel.SetData: Empire, or ActualEmpire for the player's own). */
function shownEmpire(ctx: InfoContext, bo: BuiltObject): Empire | null {
    return bo.actualEmpire === ctx.player ? bo.actualEmpire : bo.empire;
}

/** BaconInfoPanel.cs:194-209 flag1: the player can see this object's details (viewable empire, or its own). */
function builtObjectKnown(ctx: InfoContext, bo: BuiltObject): boolean {
    if (bo.empire === ctx.player || bo.actualEmpire === ctx.player) return true;
    // TODO(port): Galaxy.CheckBuiltObjectScanned (a scanning ship nearby) — BaconInfoPanel.cs:206.
    return bo.empire !== null && ctx.player.empiresViewable.includes(bo.empire);
}

export function builtObjectInfo(ctx: InfoContext, bo: BuiltObject, extended = false): InfoModel {
    const { galaxy, player } = ctx;
    const actual = shownEmpire(ctx, bo);
    const flag1 = builtObjectKnown(ctx, bo);
    const known = flag1 || actual === player;
    const color = empireTitleColor(galaxy, actual);
    const rows: InfoRow[] = [];

    // Corner: "Independent" text, else the empire flag (BaconInfoPanel.cs:222-236).
    let corner: InfoModel['corner'] = null;
    if (actual !== null && actual === galaxy.independentEmpire) corner = { text: actual.name, color: WHITE };
    else if (actual !== null) corner = { flagOf: actual, target: { kind: 'empire', empire: actual } };

    // Blockade / raid / resource shortage lines (BaconInfoPanel.cs:251-302).
    if (bo.isBlockaded) {
        const b = blockadeFor(galaxy, bo);
        if (b?.initiator) rows.push({ kind: 'line', segs: [{ img: chromeUrl('exclamation.png') }, { flagOf: b.initiator, w: 20, h: 12, gap: 2 }, txt(` Blockaded by ${b.initiator.name}`)] });
    }
    if (bo.raidCountdown > 0) rows.push({ kind: 'line', segs: [txt('(This base was recently Raided)', 0xffff00)] });
    rows.push({ kind: 'gap', h: 3 });

    // Mission line (ships only, BaconInfoPanel.cs:304-357).
    if (bo.role !== BuiltObjectRole.Base) {
        let targetsPlayer = false;
        const m = builtObjectMission(bo.mission);
        if (actual !== player && bo.role !== BuiltObjectRole.Military && m !== null) {
            targetsPlayer = m.targetBuiltObject?.empire === player || m.targetHabitat?.empire === player;
        }
        if (actual === player || flag1 || targetsPlayer) {
            let text = missionDescription(m, actual ?? galaxy.independentEmpire);
            if (bo.role === BuiltObjectRole.Military) text += engageSuffix(bo.attackRangeSquared);
            if (bo.subsequentMissions.length > 0) {
                if (extended) for (const sm of bo.subsequentMissions) text += `\nNEXT: ${missionDescription(sm as BuiltObjectMission, actual ?? galaxy.independentEmpire)}`; // BaconInfoPanel.cs 336
                else text += ` (${bo.subsequentMissions.length} queued)`;
            }
            rows.push({ kind: 'line', segs: [txt(text)], wrap: true });
        } else {
            rows.push({ kind: 'line', segs: [txt('(Unknown mission)', UNKNOWN_COLOR)] });
        }
    }
    rows.push({ kind: 'gap', h: 5 });
    rows.push({ kind: 'band' });

    // Type (BaconInfoPanel.cs:390-402).
    const subRole = resolveSubRoleDescription(bo.subRole);
    let typeText: string;
    if (bo.pirateEmpireId > 0 && ((bo.empire === galaxy.independentEmpire && actual !== bo.empire) || (bo.role === BuiltObjectRole.Freight && bo.empire !== galaxy.independentEmpire))) {
        typeText = `${subRole} (SMUGGLER)`;
    } else {
        typeText = `${subRole} (${bo.owner !== null ? 'STATE' : isPrivateer(galaxy, bo) ? 'PRIVATEER' : 'PRIVATE'})`; // privateers add-on label
    }
    rows.push(label('Type', [txt(typeText)]));
    // Empire.
    const empireText = actual === null ? '(Abandoned)' : actual === galaxy.independentEmpire ? '(Independent)' : actual.name;
    rows.push(label('Empire', [txt(empireText)], actual !== null && actual !== galaxy.independentEmpire ? { target: { kind: 'empire', empire: actual }, title: `${actual.name} (click for details)` } : {}));
    // Fleet / waypoint ETA (ships).
    if (bo.role !== BuiltObjectRole.Base) {
        const sg = bo.shipGroup as ShipGroup | null;
        if (sg !== null) {
            const segs: InfoSeg[] = [];
            if (sg.leadShip === bo) segs.push({ img: chromeUrl('fleetLeader.png'), title: 'Lead ship' });
            segs.push({ text: sg.name ?? '(None)', gap: segs.length > 0 ? 2 : 0, target: bo.empire === player ? { kind: 'select', obj: sg } : undefined, title: bo.empire === player ? `${sg.name} (click to select Fleet)` : undefined });
            rows.push(label('Fleet', segs));
        } else if (bo.actualEmpire === player && bo.currentSpeed >= Math.max(bo.cruiseSpeed, 1)) {
            // "WPT ETA" (BaconInfoPanel.cs:438-447): seconds to the move target.
            const m = builtObjectMission(bo.mission);
            const tx = m?.targetHabitat?.xpos ?? m?.targetBuiltObject?.xpos ?? (m !== null && m.x !== COORD_UNSET_DOUBLE ? m.x : null);
            const ty = m?.targetHabitat?.ypos ?? m?.targetBuiltObject?.ypos ?? (m !== null && m.y !== COORD_UNSET_DOUBLE ? m.y : null);
            if (tx !== null && ty !== null) rows.push(label('WPT ETA', [txt(String(Math.trunc(Math.hypot(tx - bo.xpos, ty - bo.ypos) / bo.currentSpeed)))]));
            else rows.push(label('Fleet', [txt('(None)')]));
        } else {
            rows.push(label('Fleet', [txt('(None)')]));
        }
    }
    // Design (+ hotspot for the player's own).
    rows.push(label('Design', [txt(`${bo.design?.name ?? ''} (size ${bo.size})`)]));
    // Components (BaconInfoPanel.cs:461-490), drawn under the Design value.
    if (actual === player || actual === null || flag1) {
        let text = '(All components normal)';
        const damaged = bo.damagedComponentCount;
        const unbuilt = bo.unbuiltComponentCount;
        const disabled = bo.disabledComponentIndexes !== null ? bo.disabledComponentIndexes.length : 0;
        if (damaged > 0 || unbuilt > 0 || disabled > 0) {
            const parts: string[] = [];
            if (damaged > 0) parts.push(`${damaged} damaged`);
            if (disabled > 0) parts.push(`${disabled} disabled`);
            if (unbuilt > 0) parts.push(`${unbuilt} unbuilt`);
            text = `Components: ${parts.join(', ')}`;
            // Streamlined: the percent built (InfoPanel.cs:1382 OverlayConstructionProgress formula) while unbuilt.
            if (unbuilt > 0 && bo.components.count > 0) text += ` (${Math.round((100 * (bo.components.count - unbuilt)) / bo.components.count)}% built)`;
        } else if (bo.retrofitDesign !== null) {
            const pct = retrofitProgressPercent(bo);
            text = `(RETROFITTING to ${bo.retrofitDesign.name}${pct === null ? '' : pct < 0 ? ' — waiting for a yard' : `: ${pct}%`})`;
        }
        rows.push(label('', [txt(text)]));
    } else {
        rows.push(label('', [txt('(Unknown component status)', UNKNOWN_COLOR)]));
    }

    // Resupply ship deploy status (BaconInfoPanel.cs:492-551).
    if (bo.subRole === BuiltObjectSubRole.ResupplyShip) {
        if (bo.isDeployed) rows.push({ kind: 'bar', label: 'Status', max: 30, current: 30, inner: 'DEPLOYED', right: '30 sec', fill: BAR_FILL });
        else if (bo.deployProgress > 0) {
            const cur = Math.trunc(bo.deployProgress * 30);
            rows.push({ kind: 'bar', label: 'Status', max: 30, current: cur, inner: `Deploying (${30 - cur} sec)`, right: '30 sec', fill: BAR_FILL });
        } else if (bo.deployProgress < 0) {
            const n = Math.trunc(Math.abs(bo.deployProgress) * 30);
            rows.push({ kind: 'bar', label: 'Status', max: 30, current: 30 - n, inner: `Undeploying (${30 - n} sec)`, right: '30 sec', fill: BAR_FILL });
        } else rows.push({ kind: 'bar', label: 'Status', max: 30, current: 0, inner: '(Not Deployed)', right: '30 sec', fill: BAR_FILL });
    }
    // Colony ship race / colonize (BaconInfoPanel.cs:552-592).
    if (bo.subRole === BuiltObjectSubRole.ColonyShip) {
        if (known) {
            rows.push(label('Race', [txt(bo.nativeRace?.name ?? '(None)')]));
        } else {
            rows.push(label('Race', [txt('(Unknown)', UNKNOWN_COLOR)]));
            rows.push(label('Colonize', [txt('(Unknown)', UNKNOWN_COLOR)]));
        }
    }
    // Passengers (BaconInfoPanel.cs:593-616).
    if (bo.populationCapacity > 0) {
        if (known) {
            let text = '(No passengers)';
            const pop = bo.population;
            if (pop !== null && pop.totalAmount > 0) text = `${fmtK(pop.totalAmount)} (${pop.items.map((p) => p.race.name).join(', ')})`;
            rows.push(label('Onboard', [txt(text)]));
        } else rows.push(label('Onboard', [txt('(Unknown passengers)', UNKNOWN_COLOR)]));
    }
    if (bo.subRole !== BuiltObjectSubRole.ResupplyShip) rows.push({ kind: 'gap', h: 5 });

    // Fuel / Energy / Shields / Speed bar graphs (BaconInfoPanel.cs:604-651).
    if (known) {
        const cur = Math.max(0, Math.trunc(bo.currentFuel));
        const low = bo.currentFuel < Math.trunc(bo.fuelCapacity / 3);
        const suffix = bo.currentFuel <= 0 && bo.role !== BuiltObjectRole.Base && bo.unbuiltComponentCount === 0 ? ' (speed reduced)' : '';
        rows.push({ kind: 'bar', label: 'Fuel', max: Math.trunc(bo.fuelCapacity), current: cur, inner: `${cur}${suffix}`, right: String(Math.trunc(bo.fuelCapacity)), fill: low ? BAR_FILL_LOW : BAR_FILL });
        const e = Math.max(0, Math.trunc(bo.currentEnergy));
        rows.push({ kind: 'bar', label: 'Energy', max: Math.trunc(bo.reactorStorageCapacity), current: e, inner: String(e), right: String(Math.trunc(bo.reactorStorageCapacity)), fill: BAR_FILL });
    } else {
        rows.push(label('Fuel', [txt('(Unknown)', UNKNOWN_COLOR)]));
        rows.push(label('Energy', [txt('(Unknown)', UNKNOWN_COLOR)]));
    }
    const sh = Math.trunc(bo.currentShields);
    rows.push({ kind: 'bar', label: 'Shields', max: Math.trunc(bo.shieldsCapacity), current: sh, inner: `${sh}${bo.shieldsReducedLocation ? ' (reducing)' : ''}`, right: String(Math.trunc(bo.shieldsCapacity)), fill: BAR_FILL });
    if (bo.role !== BuiltObjectRole.Base) {
        let suffix = '';
        if (bo.movementSlowedLocation && bo.currentSpeed < bo.warpSpeed) suffix += ' (slowed)';
        if (bo.hyperjumpDisabledLocation) suffix += ' (Hyper block)';
        if (bo.warpSpeed <= 0) suffix = ' (No Hyperdrive)';
        const sp = Math.trunc(bo.currentSpeed);
        rows.push({ kind: 'bar', label: 'Speed', max: Math.trunc(bo.topSpeed), current: sp, inner: `${sp}${suffix}`, right: String(Math.trunc(bo.topSpeed)), fill: BAR_FILL, alt: bo.hyperjumpPrepare ? BAR_FILL_ALT : undefined });
    }
    rows.push({ kind: 'gap', h: 5 });

    // Boarding defence (BaconInfoPanel.cs:652-658).
    if (bo.assaultAttackValue > 0) rows.push(label('BOARDING', [txt(`Attackers ${bo.assaultAttackValue}   vs   Defenders ${bo.assaultDefenseValue}`)]));
    // Troops (BaconInfoPanel.cs:659-676).
    if (known) {
        if (bo.troopCapacity > 0) {
            const used = bo.troopCapacity - bo.troopCapacityRemaining;
            const troops = troopItems(bo.troops);
            rows.push(label('Troops', troops.length > 0 ? [txt(`${used}/${bo.troopCapacity}`), ...troopSegs(troops, [], []).map((s, i) => (i === 0 ? { ...s, gap: 4 } : s))] : [txt(`${used}/${bo.troopCapacity}`)]));
        }
    } else {
        rows.push(label('Troops', [txt('(Unknown)', UNKNOWN_COLOR)]));
    }
    // Weapons (BaconInfoPanel.cs:710-713).
    rows.push(label('Weapons', [txt(bo.firepowerRaw === 0 ? '(None)' : `Firepower: ${bo.firepowerRaw}, Range: ${Math.trunc(bo.maximumWeaponsRange)}`)]));
    // Boarding pods (BaconInfoPanel.cs:715-724).
    if (bo.assaultRange > 0 && bo.assaultStrength > 0) {
        rows.push(label('Boarding', [txt(`Strength: ${Math.round(calculateAvailableAssaultPodAttackStrength(galaxy, bo, galaxy.nowMs))}`)]));
    }
    // Fighters (BaconInfoPanel.cs:725-739, InfoPanel.cs 2979 DrawFighters).
    if (known) {
        const fighters = (bo.fighters ?? []) as Fighter[];
        if (bo.fighterCapacity > 0 || fighters.length > 0) rows.push(label('Fighters', fighterSegs(fighters), { strip: true }));
    } else {
        rows.push(label('Fighters', [txt('(Unknown)', UNKNOWN_COLOR)]));
    }
    // Building / Docked (BaconInfoPanel.cs:740-776).
    const building = buildingRow(ctx, bo.constructionQueue as ConstructionQueue | null);
    if (building !== null) rows.push(building);
    if (building !== null && actual === player) rows.push(...waitingRows(ctx, bo)); // [improvements] supplyChain
    const docked = dockedRow(ctx, bo.dockingBays, bo.dockingBayWaitQueue);
    if (docked !== null) rows.push(docked);
    // BaconInfoPanel.cs 777: DrawLabel("Bonuses") + the _CharacterBonuses text (Galaxy.2.cs 4152), ShowExtendedInfo only.
    if (extended) {
        const bonuses = builtObjectCharacterBonusDescription(bo);
        if (bonuses !== '') rows.push(label('Bonuses', [txt(bonuses)], { wrap: true }));
    }

    // Streamlined additions (not rows in the original): hyperdrive readiness, cargo, scenario threat markers.
    if (actual === player) {
        if (bo.role !== BuiltObjectRole.Base) rows.push(label('Hyperjump', [txt(hyperjumpStatusText(bo))]));
        if (bo.cargoCapacity > 0) {
            let used = 0;
            for (const c of bo.cargo?.items ?? []) used += Math.max(0, c.amount);
            // Bases have an effectively unlimited hold (int.MaxValue-style capacity): show only what is stored.
            rows.push(label('Cargo', [txt(bo.cargoCapacity >= 1e8 ? fmtK(used) : `${fmtK(used)} / ${fmtK(bo.cargoCapacity)}`)]));
        }
    }
    for (const r of threatRows(bo, player)) rows.push(label(r.label, [txt(r.value)]));
    for (const r of wreckSalvageRows(galaxy, bo, player)) rows.push(label(r.label, [txt(r.value)])); // [wreckage] 19e-7

    const angle = (bo.heading * 180) / Math.PI + 90;
    return {
        title: [{ text: bo.name, color }],
        corner,
        picture: picture(shipImageUrl(bo), bo.size / 0.6, angle),
        rows,
        labelWidth: 52, // MeasureString("Weapons", bold) at the panel font
        automated: actual === player && bo.isAutoControlled,
    };
}

/**
 * InfoPanel.cs 2979 DrawFighters: launched fighters, then those onboard, then those being built (faded); a red chip
 * behind a damaged one. Each picture is a hotspot (AddHotspot(…, fighter, text)): a click selects the fighter
 * (Main.Part4.cs 3547 pnlDetailInfo_MouseClick → method_208), whose own buttons then launch / retrieve / retire it.
 */
function fighterSegs(fighters: readonly Fighter[]): InfoSeg[] {
    if (fighters.length === 0) return [txt('(None)')];
    const out = fighters.filter((f) => !f.onboardCarrier);
    const onboard = fighters.filter((f) => f.onboardCarrier && !f.underConstruction);
    const building = fighters.filter((f) => f.onboardCarrier && f.underConstruction);
    const segs: InfoSeg[] = [];
    // 3049 / 3068: num8 += num4 (half an image) after the launched and after the onboard group, whether empty or not.
    let gap = 0;
    const add = (f: Fighter, faded: boolean, title: string): void => {
        segs.push({ img: fighterImageUrl(f.pictureRef) ?? undefined, bg: !faded && f.health < 1 ? 'rgb(255,0,0)' : undefined, faded, gap, title, target: { kind: 'select', obj: f } });
        gap = 0;
    };
    // 3046: Name + " (" + Galaxy.ResolveMissionDescription(fighter) + ")".
    out.forEach((f) => add(f, false, `${f.name} (${fighterMissionDescription(f)})`));
    gap += INFO.imageSize / 2;
    // 3052 / 3060-3065: red behind a damaged one (not while being built); " (Onboard <carrier>)" when it has a carrier.
    onboard.forEach((f) => add(f, false, f.parentBuiltObject !== null ? `${f.name} (Onboard ${f.parentBuiltObject.name})` : f.name));
    gap += INFO.imageSize / 2;
    building.forEach((f) => add(f, true, `${f.name} (Building)`));
    return segs;
}

// ---------------------------------------------------------------------------------------------------------------
// ShipGroup (BaconInfoPanel.cs 791 DrawShipGroup)
// ---------------------------------------------------------------------------------------------------------------

/** A 27 px ship cell of the fleet / multi-selection grid. */
function shipCell(ctx: InfoContext, bo: BuiltObject, detailed: boolean, multi: boolean): ShipCell {
    const side = Math.min(Math.trunc(Math.sqrt(bo.size) * 1.25), 27);
    let bg: string | null = null;
    let state = '';
    if (bo.damagedComponentCount > 0 && detailed) {
        if (multi) bg = css(0xff0040, 64);
        else {
            // Hyperdrive knocked out (cyan) / only armour damaged (yellow) / other damage (red), BaconInfoPanel.cs:451-475.
            bg = bo.warpSpeed === 0 ? css(0x00ffff, 64) : css(0xff0040, 64);
        }
    } else if (!multi && bo.unbuiltComponentCount > 0 && detailed) {
        bg = css(0xff8000, 32);
        state = 'Under construction';
    }
    const fuel = detailed && bo.fuelCapacity > 0 ? Math.max(0, Math.min(1, bo.currentFuel / bo.fuelCapacity)) : null;
    const role = resolveSubRoleDescription(bo.subRole);
    return {
        ship: bo,
        img: shipImageUrl(bo),
        side,
        bg,
        fuel,
        title: multi ? `${bo.name} (click to select)` : `${role} ${bo.name} (${state !== '' ? `${state} - ` : ''}click to select)`,
        clickable: !bo.hasBeenDestroyed,
    };
}

/** `extended`: InfoPanel.ShowExtendedInfo (the Fleets window's pnlDetailInfoShipGroup): the queued missions are listed
 *  one per line ("NEXT: ...") instead of "(n queued)". */
export function shipGroupInfo(ctx: InfoContext, sg: ShipGroup, extended = false): InfoModel {
    const { galaxy, player } = ctx;
    const empire = sg.empire;
    const flag1 = empire !== player && empire !== null && player.empiresViewable.includes(empire);
    const known = empire === player || flag1;
    const color = empireTitleColor(galaxy, empire);
    const rows: InfoRow[] = [];
    rows.push({ kind: 'gap', h: 2 });
    if (known) {
        let text = missionDescription(sg.mission, empire) + engageSuffix(sg.attackRangeSquared);
        if (sg.subsequentMissions.length > 0) {
            if (extended) for (const m of sg.subsequentMissions) text += `\nNEXT: ${missionDescription(m, empire)}`;
            else text += ` (${sg.subsequentMissions.length} queued)`;
        }
        rows.push({ kind: 'line', segs: [txt(text)], wrap: true });
    } else rows.push({ kind: 'line', segs: [txt('(Unknown mission)', UNKNOWN_COLOR)] });
    if (sg.localDefenseTacticsApply) rows.push({ kind: 'line', segs: [txt('Local Defense Tactics: +20% Targeting & Countermeasures', 0x00ff00)] });
    rows.push({ kind: 'gap', h: 4 });
    rows.push({ kind: 'band' });
    rows.push(label('Empire', [txt(empire?.name ?? '')], empire !== null ? { target: { kind: 'empire', empire }, title: `${empire.name} (click for details)` } : {}));
    rows.push(label('Based At', [txt(sg.gatherPoint?.name ?? '(None)')]));
    rows.push(label('Posture', known ? [txt(fleetPostureDescription(sg))] : [txt('(Unknown)', UNKNOWN_COLOR)]));
    let fighters = 0;
    let troopStrength = 0;
    for (const s of sg.ships) {
        fighters += s.fighters?.length ?? 0;
        if (s.troops !== null) troopStrength += s.troops.totalAttackStrength;
    }
    rows.push(label('Summary', [txt(known ? `${sg.ships.length} ships, ${fleetTotalFirepower(sg)} firepower, ${fighters} fighters` : `${sg.ships.length} ships`)]));
    if (known) {
        const allTroops: Troop[] = [];
        for (const s of sg.ships) allTroops.push(...troopItems(s.troops));
        const c = troopCountsByType(allTroops);
        let comp = troopCompositionDescription(c.infantry, c.artillery, c.armor, c.specialForces);
        if (comp === '') comp = '(No units)';
        rows.push(label('Troops', [txt(`${fmtK(troopStrength)} strength,  ${shipGroupTotalTroopSpaceUsed(sg)}/${shipGroupTotalTroopCapacity(sg)}: ${comp}`)]));
    } else rows.push(label('Troops', [txt('(Unknown)', UNKNOWN_COLOR)]));
    let pods = 0;
    let podStrength = 0;
    for (const s of sg.ships) {
        if (s.assaultRange > 0 && s.assaultStrength > 0) {
            pods++;
            podStrength += calculateAvailableAssaultPodAttackStrength(galaxy, s, galaxy.nowMs);
        }
    }
    if (pods > 0) rows.push(label('Boarding', [txt(`Strength: ${Math.round(podStrength)}`)]));
    // Not in the original: the player's fleet design for the fleet, auto-refill and its replacements (fleetRefill.ts).
    if (empire === player) {
        const refill = fleetTemplateSummary(fleetRefillStatus(galaxy, player, sg));
        if (refill !== '') rows.push(label('Template', [txt(refill)], { title: `${refill}\n(click for the fleet's template, auto-refill and Replenish)`, target: { kind: 'fleetTemplate', fleet: sg } }));
    }
    rows.push({ kind: 'gap', h: Math.trunc(INFO.rowHeight / 4) });
    // Biggest ships first (user call), ties in fleet order.
    const byBiggest = sg.ships.filter((s) => s != null).map((s, i) => ({ s, i })).sort((a, b) => b.s.size - a.s.size || a.i - b.i).map((x) => x.s);
    rows.push({ kind: 'grid', indent: 1, cells: byBiggest.map((s) => shipCell(ctx, s, known, false)) });
    // BaconInfoPanel.cs 1067: DrawLabel("Bonuses") + the fleet's _CharacterBonuses (Galaxy.2.cs 4084), ShowExtendedInfo only.
    if (extended) {
        const bonuses = shipGroupCharacterBonusDescription(sg);
        if (bonuses !== '') rows.push(label('Bonuses', [txt(bonuses)], { wrap: true }));
    }

    const title: InfoSeg[] = [{ text: sg.name ?? '(Unnamed fleet)', color }];
    if (sg.leadShip !== null) title.push({ text: `(${sg.leadShip.name})`, color, gap: 2, tiny: false, w: -1 });
    return {
        title,
        corner: empire !== null ? { flagOf: empire, target: { kind: 'empire', empire } } : null,
        picture: null,
        rows,
        labelWidth: 54, // MeasureString("Lead Ship", bold)
        automated: empire === player && sg.leadShip?.isAutoControlled === true,
    };
}

// ---------------------------------------------------------------------------------------------------------------
// BuiltObjectList (InfoPanel.cs 5059 DrawBuiltObjectSelection)
// ---------------------------------------------------------------------------------------------------------------

export function multiShipInfo(ctx: InfoContext, ships: readonly BuiltObject[]): InfoModel {
    const { galaxy, player } = ctx;
    const first = ships[0];
    const empire = first?.empire ?? null;
    const known = empire === player || (empire !== null && player.empiresViewable.includes(empire));
    let text = `${ships.length} ships`;
    if (known) {
        let firepower = 0;
        let boarding = 0;
        let troops = 0;
        let troopStrength = 0;
        for (const bo of ships) {
            firepower += bo.firepowerRaw;
            boarding += calculateAvailableAssaultPodAttackStrength(galaxy, bo, galaxy.nowMs);
            if (bo.troops !== null) {
                troops += bo.troops.count;
                troopStrength += bo.troops.totalAttackStrength;
            }
        }
        text += `, ${firepower} firepower, ${Math.round(boarding)} boarding strength, ${troops} troops (${troopStrength} strength)`;
    }
    return {
        title: [{ text: '(Multiple Ships)', color: empireTitleColor(galaxy, empire) }],
        corner: empire !== null ? { flagOf: empire, target: { kind: 'empire', empire } } : null,
        picture: null,
        rows: [
            { kind: 'gap', h: 3 },
            { kind: 'line', segs: [txt(text)], wrap: true },
            { kind: 'gap', h: Math.trunc(INFO.rowHeight / 4) },
            { kind: 'grid', indent: -7, cells: ships.map((s) => shipCell(ctx, s, known, true)) },
        ],
        labelWidth: 0,
        automated: false,
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Fighter (InfoPanel.cs 3495 DrawFighter)
// ---------------------------------------------------------------------------------------------------------------

/** Port of Galaxy.2.cs 5675 ResolveMissionDescription(Fighter). */
export function fighterMissionDescription(f: Pick<Fighter, 'missionType' | 'currentTarget' | 'parentBuiltObject'>): string {
    switch (f.missionType) {
        case FighterMissionType.Undefined:
            return '(No mission)';
        case FighterMissionType.Attack: {
            const t = f.currentTarget as { name?: string } | null;
            return t === null ? 'Attack' : `Attack ${t.name ?? ''}`;
        }
        case FighterMissionType.Patrol:
            return f.parentBuiltObject === null ? 'Patrol' : `Patrol ${f.parentBuiltObject.name}`;
        case FighterMissionType.ReturnToCarrier:
            return f.parentBuiltObject !== null ? `Return to carrier (${f.parentBuiltObject.name})` : 'Return to carrier';
        default:
            return '';
    }
}

/**
 * Port of Galaxy.2.cs 4043 GenerateCharacterBonusDescription(Fighter) — InfoPanel.cs 987 _CharacterBonuses for a
 * fighter: the carrier captain's Fighters bonus plus its fleet admiral's (ShipGroup.FightersBonus, ADDED to the
 * captain's factor as the C# does: a carrier in a fleet starts from 2.0), e.g. "Ship Captain, Fleet Admiral: +25%
 * Fighters". Empty without a carrier or when the sum is exactly 1.
 */
export function fighterCharacterBonusDescription(fighter: Pick<Fighter, 'parentBuiltObject'>): string {
    let text = '';
    const carrier = fighter.parentBuiltObject;
    if (carrier === null) return text;
    let flag = false;
    let flag2 = false;
    let num = captainFightersBonus(carrier);
    if (num !== 1.0) flag = true;
    const group = carrier.shipGroup as ShipGroup | null;
    if (group !== null && group !== undefined) {
        num += group.fightersBonus;
        if (group.fightersBonus !== 1.0) flag2 = true;
    }
    if (num !== 1.0) {
        if (flag) text = text + resolveEnumTextDescription(CHARACTER_ROLE, CharacterRole[CharacterRole.ShipCaptain]) + ', ';
        if (flag2) text = text + resolveEnumTextDescription(CHARACTER_ROLE, CharacterRole[CharacterRole.FleetAdmiral]) + ', ';
        if (text !== '' && text.length > 2) text = text.substring(0, text.length - 2);
        text = text + ': ' + fmtPlusMinusPct(num - 1.0) + ' ' + resolveEnumTextDescription(CHARACTER_SKILL, CharacterSkillType[CharacterSkillType.Fighters]);
    }
    return text;
}

/** Port of InfoPanel.cs 3495 DrawFighter. */
export function fighterInfo(ctx: InfoContext, fi: Fighter): InfoModel {
    const { galaxy, player } = ctx;
    const e = fi.empire;
    // flag: another empire's fighter the player can view (EmpiresViewable).
    const viewable = e !== player && e !== null && player.empiresViewable.includes(e);
    const known = e === player || viewable;
    let corner: InfoModel['corner'] = null;
    if (e !== null && e === galaxy.independentEmpire) corner = { text: e.name, color: WHITE };
    else if (e !== null) corner = { flagOf: e, target: { kind: 'empire', empire: e } };
    const rows: InfoRow[] = [{ kind: 'gap', h: 8 }];
    rows.push(known ? { kind: 'line', segs: [txt(fighterMissionDescription(fi))] } : { kind: 'line', segs: [txt('(Unknown mission)', UNKNOWN_COLOR)] });
    rows.push({ kind: 'gap', h: 5 });
    rows.push({ kind: 'band' });
    const empireText = e === null ? '(Abandoned)' : e === galaxy.independentEmpire ? '(Independent)' : e.name;
    rows.push(label('Empire', [txt(empireText)]));
    rows.push({ kind: 'gap', h: 5 });
    if (known) {
        const hp = Math.trunc(fi.health * 100);
        rows.push({ kind: 'bar', label: 'Health', max: 100, current: hp, inner: `${hp}${fi.underConstruction ? ' (under construction)' : ''}`, right: '100', fill: BAR_FILL });
        const en = Math.max(0, Math.trunc(fi.currentEnergy));
        rows.push({ kind: 'bar', label: 'Energy', max: fi.specification.energyCapacity, current: en, inner: String(en), right: String(fi.specification.energyCapacity), fill: BAR_FILL });
    } else {
        rows.push(label('Health', [txt('(Unknown)', UNKNOWN_COLOR)]));
        rows.push(label('Energy', [txt('(Unknown)', UNKNOWN_COLOR)]));
    }
    const sh = Math.trunc(fi.currentShields);
    rows.push({ kind: 'bar', label: 'Shields', max: fi.specification.shieldsCapacity, current: sh, inner: `${sh}${fi.shieldsReducedLocation ? ' (reducing)' : ''}`, right: String(fi.specification.shieldsCapacity), fill: BAR_FILL });
    const sp = Math.trunc(fi.currentSpeed);
    rows.push({ kind: 'bar', label: 'Speed', max: fi.topSpeed, current: sp, inner: `${sp}${fi.movementSlowedLocation ? ' (slowed)' : ''}`, right: String(fi.topSpeed), fill: BAR_FILL });
    rows.push({ kind: 'gap', h: 5 });
    rows.push(label('Weapons', [txt(fi.firepowerRaw === 0 ? '(None)' : `Firepower: ${fi.firepowerRaw}, Range: ${fi.specification.weaponRange}`)]));
    // 3627-3634: DrawLabel("Bonuses") + the _CharacterBonuses text bounded to the content width (wrapped).
    const bonuses = fighterCharacterBonusDescription(fi);
    if (bonuses !== '') rows.push(label('Bonuses', [txt(bonuses)], { wrap: true }));
    return {
        title: [{ text: fi.name, color: empireTitleColor(galaxy, e) }],
        corner,
        picture: picture(fighterImageUrl(fi.pictureRef), fi.size / 0.6, (fi.heading * 180) / Math.PI + 90),
        rows,
        labelWidth: 52,
        automated: false,
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Creature (InfoPanel.cs 3453 DrawCreature)
// ---------------------------------------------------------------------------------------------------------------

export function creatureInfo(_ctx: InfoContext, c: Creature, pictureUrl: string | null): InfoModel {
    const health = Math.trunc(c.damageKillThreshold - c.damage);
    return {
        title: [{ text: c.name, color: WHITE }],
        corner: null,
        picture: picture(pictureUrl, c.size / 0.6, c.currentHeading * (180 / Math.PI) + 90),
        rows: [
            { kind: 'gap', h: 8 },
            { kind: 'line', segs: [txt(`Size: ${c.size}, Attack Strength: ${c.attackStrength}`)] },
            // Streamlined: the creature type under the size line (the C# has it only in the hover text).
            { kind: 'line', segs: [txt(resolveCreatureDescription(c.type), 0xc0c0c0)] },
            { kind: 'gap', h: 10 },
            { kind: 'band' },
            { kind: 'bar', label: 'Health', max: c.damageKillThreshold, current: health, inner: String(health), right: String(c.damageKillThreshold), fill: BAR_FILL },
            { kind: 'gap', h: 5 },
            { kind: 'bar', label: 'Speed', max: c.movementSpeed, current: Math.trunc(c.currentSpeed), inner: String(Math.trunc(c.currentSpeed)), right: String(c.movementSpeed), fill: BAR_FILL },
        ],
        labelWidth: INFO.labelWidth - 5,
        automated: false,
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Habitat (InfoPanel.cs 3887 DrawHabitat)
// ---------------------------------------------------------------------------------------------------------------

/** "PlanetType Abbreviation …" (InfoPanel.cs 3718-3751). */
export function planetTypeAbbreviation(h: Habitat): string {
    if (h.category === HabitatCategoryType.Asteroid) return 'Ast';
    if (h.category === HabitatCategoryType.GasCloud) return 'Cld';
    switch (h.type) {
        case HabitatType.BarrenRock: return 'Rock';
        case HabitatType.Continental: return 'Cont';
        case HabitatType.Desert: return 'Des';
        case HabitatType.Ice: return 'Ice';
        case HabitatType.MarshySwamp: return 'Mrsh';
        case HabitatType.Ocean: return 'Ocn';
        case HabitatType.Volcanic: return 'Volc';
        case HabitatType.FrozenGasGiant: return 'FzGs';
        case HabitatType.GasGiant: return 'Gas';
        default: return '';
    }
}

/** "Desert Moon, 23.9K, Quality: 88%" (InfoPanel.cs 4006-4025). */
export function habitatDescriptionLine(h: Habitat): string {
    let text = habitatTypeLabel(h.type);
    if (h.type !== HabitatType.BlackHole) text += ` ${categoryLabel(h.category)}`;
    text += `, ${(h.diameter / 10).toFixed(1)}K`;
    if (h.category === HabitatCategoryType.Planet || h.category === HabitatCategoryType.Moon) {
        text += `,   Quality: ${Math.round(h.quality * 100)}%`;
        if (h.baseQuality !== h.quality) text += ` (Max ${Math.round(h.baseQuality * 100)}%)`;
    }
    return text;
}

/** The system star of a habitat (Galaxy.DetermineHabitatSystemStar). */
function habitatSystemStar(galaxy: Galaxy, h: Habitat): Habitat | null {
    return galaxy.systems[h.systemIndex]?.systemStar ?? null;
}

/** InfoPanel.cs 3086 DrawPopulation: the top race, an "Others" sum for 3+ races, and a TOTAL line for 2+. */
function populationRows(h: Habitat, color: number): InfoRow[] {
    const pops = h.population.items.slice().sort((a, b) => b.amount - a.amount);
    const atMax = h.maxPopulation > 0 && h.population.totalAmount >= h.maxPopulation;
    const rows: InfoRow[] = [];
    const W = INFO.populationTextWidth;
    const A = INFO.populationAmountWidth;
    for (let i = 0; i < pops.length && i < 2; i++) {
        let race: Race | null = pops[i].race;
        let name = race.name;
        let amount = fmtLarge(pops[i].amount);
        let growth = atMax ? 'Max' : fmtSignedPct(pops[i].growthRate - 1);
        if (i === 1 && pops.length > 2) {
            race = null;
            name = 'Others';
            let sum = 0;
            for (let j = 1; j < pops.length; j++) sum += Math.max(0, pops[j].amount);
            amount = fmtLarge(sum);
            growth = '';
        }
        rows.push(label(i === 0 ? 'Populace' : '', [
            // InfoPanel.cs 3137 / 3150: a race hotspot; Main.Part4.cs 3603 → method_456(race.Name).
            race !== null ? { img: raceImageUrl(race) ?? undefined, title: `${race.name} (click for details)`, target: { kind: 'galactopedia', topic: race.name } } : { width: INFO.imageSize },
            { text: name, color, width: W },
            { text: amount, color, width: A },
            { text: growth, color: atMax ? 0xff0000 : color },
        ], { strip: true }));
    }
    if (pops.length > 1) {
        let overall = 0;
        let total = 0;
        for (const p of pops) {
            total += p.amount;
            overall += p.amount * p.growthRate;
        }
        const growth = atMax ? 'Max' : fmtSignedPct(total > 0 ? overall / total - 1 : 0);
        rows.push(label('', [{ width: INFO.imageSize }, { text: 'TOTAL:', color, width: W }, { text: `${Math.round(h.population.totalAmount / 1000000)}M`, color, width: A }, { text: growth, color: atMax ? 0xff0000 : color }]));
    }
    if (rows.length === 0) rows.push(label('Populace', [txt('(None)', color)]));
    return rows;
}

export function habitatInfo(ctx: InfoContext, h: Habitat): InfoModel {
    const { galaxy, player } = ctx;
    const owner = h.empire;
    const independent = owner === null || owner === galaxy.independentEmpire;
    // flag: an empire whose colonies the player can see in detail (EmpiresViewable, or pirate control).
    let flag = false;
    if (owner !== player && owner !== null) {
        if (player.empiresViewable.includes(owner)) flag = true;
        else if (h.pirateColonyControl.items.some((c) => c.empireId === player.empireId)) flag = true;
    }
    const vis = systemVisibility(ctx, h.systemIndex);
    const explored = vis !== SystemVisibilityStatus.Unexplored;
    const color = explored ? WHITE : UNKNOWN_COLOR;
    const resColor = resourcesKnown(ctx, h) ? WHITE : UNKNOWN_COLOR;
    const star = habitatSystemStar(galaxy, h);
    const rows: InfoRow[] = [];

    // Title (InfoPanel.cs 3956-3999): capital icon, the name in the empire colour, "(Empire)" after it.
    const title: InfoSeg[] = [];
    if (!independent && owner !== null) {
        if (owner.capital === h) title.push({ img: chromeUrl('capital.png'), title: 'Capital' });
        else if (owner.capitals.includes(h)) title.push({ img: chromeUrl('capital.png'), title: 'Regional capital' });
    }
    const titleColor = owner !== null ? empireTitleColor(galaxy, owner) : WHITE;
    if (explored) {
        title.push({ text: h.name, color: titleColor, gap: title.length > 0 ? 2 : 0 });
        if (!independent && owner !== null) title.push({ text: `(${owner.name})`, color: titleColor, gap: 7, w: -1 });
    } else {
        title.push({ text: `(Unknown ${categoryLabel(h.category)})`, color: UNKNOWN_COLOR });
    }
    let corner: InfoModel['corner'] = null;
    if (!independent && owner !== null) corner = { flagOf: owner, target: { kind: 'empire', empire: owner } };
    else if (h.population.totalAmount > 0) corner = { text: 'Independent', color };

    rows.push({ kind: 'gap', h: 3 });
    // InfoPanel.cs 4089-4094: an explored / visible habitat's ruin picture after the description line, a hotspot
    // "Name (click for details)" (Main.Part4.cs 3581 → method_550, the Ruin Detail window).
    const descSegs: InfoSeg[] = [txt(habitatDescriptionLine(h), color)];
    if (explored && h.ruin !== null) {
        descSegs.push({ img: `/assets/dwu/images/environment/ruins/ruin_${h.ruin.pictureRef}.png`, w: 30, h: 18, gap: 8, title: `${h.ruin.name} (click for details)`, target: { kind: 'ruin', ruin: h.ruin } });
    }
    rows.push({ kind: 'line', segs: descSegs });

    if (explored) {
        // Plague (InfoPanel.cs 4097-4118).
        if (h.plagueId >= 0) {
            const plague = galaxyPlagues(galaxy)[h.plagueId] ?? null;
            if (plague !== null) rows.push({ kind: 'line', segs: [txt(`INFECTED WITH ${plague.name.toUpperCase()}!`, 0xff0000)] });
        }
        if (h.isBlockaded) {
            const b = blockadeFor(galaxy, h);
            if (b?.initiator) rows.push({ kind: 'line', segs: [{ img: chromeUrl('exclamation.png') }, { flagOf: b.initiator, w: 20, h: 12, gap: 2 }, txt(` Blockaded by ${b.initiator.name}`, color)] });
        }
        if (h.raidCountdown > 0) rows.push({ kind: 'line', segs: [txt('(This colony was recently Raided)', 0xffff00)] });
        rows.push({ kind: 'gap', h: 5 });
        rows.push({ kind: 'band' });

        if (star === h && h.category !== HabitatCategoryType.GasCloud) {
            // A star: radiation, research / scenery, the queued-base note and the system's colonies (4176-4229).
            rows.push(label('ENERGY', [txt(`Solar ${h.solarRadiation}, Microwave ${h.microwaveRadiation}, X-ray ${h.xrayRadiation}`, color)]));
            if (h.researchBonus > 0) rows.push(label('Research', [txt(`${fmtSignedPct(h.researchBonus / 100)} bonus to ${industryLabel(h.researchBonusIndustry)} research`, color)]));
            if (h.scenicFactor > 0) rows.push(label('Scenery', [txt(fmtSignedPct(h.scenicFactor), color)]));
            const queued = checkBasesToBeBuiltAtHabitat(player, h);
            if (queued.length > 0) rows.push(label('', [txt(`Construction ship queued to build ${resolveSubRoleDescription(queued[0].subRole)} here`)], { wrap: true }));
            rows.push({ kind: 'gap', h: INFO.rowHeight });
            rows.push(coloniesSummaryRow(ctx, h));
        } else {
            rows.push(label('System', [txt(star?.name ?? '', color)], star !== null ? { target: { kind: 'select', obj: star }, title: `${star.name} (click to select)` } : {}));
            if (h.researchBonus > 0) rows.push(label('Research', [txt(`${fmtSignedPct(h.researchBonus / 100)} bonus to ${industryLabel(h.researchBonusIndustry)} research`, color)]));
            if (h.scenicFactor > 0) {
                const s = fmtSignedPct(h.scenicFactor);
                rows.push(label('Scenery', [txt(h.scenicFeature !== '' ? `${s} from ${h.scenicFeature}` : s, color)]));
            }
            // InfoPanel.cs 4257-4264: the Ruins row, its name a "click for details" hotspot.
            if (h.ruin !== null) rows.push(label('Ruins', [{ ...txt(h.ruin.name, color), target: { kind: 'ruin', ruin: h.ruin }, title: `${h.ruin.name} (click for details)` }]));
            rows.push({ kind: 'gap', h: 4 });
            if (h.population.totalAmount > 0) rows.push(...populationRows(h, color));
            if (independent) {
                // Colonize (InfoPanel.cs 4269-4285).
                const can = canEmpireColonizeHabitatExplained(galaxy, player, h);
                const likely = player.dominantRace !== null ? checkColonizationLikeliness(galaxy, h, player.dominantRace) : 0;
                const red = !(can.result && likely > -5 && !(h.quality < 0.5));
                const text = can.result && h.quality < 0.5 ? 'Yes, but low quality is undesirable' : can.explanation;
                rows.push(label('Colonize', [txt(text, red ? 0xff0000 : color)]));
            }
            // Resource.
            if (owner === player || resourcesKnown(ctx, h)) rows.push(label('Resource', resourceSegs(ctx, h.resources, resColor), { strip: true }));
            else rows.push(label('Resource', [txt('(Unknown)', resColor)]));
            rows.push({ kind: 'gap', h: 4 });
            // Value / GDP / Tax for an empire's populated colony (InfoPanel.cs 4302-4398).
            if (h.population.totalAmount > 0 && !independent && owner !== null) {
                const segs: InfoSeg[] = [txt(fmtK(strategicValue(h)), color)];
                let dev = `${Math.round(habitatDevelopmentLevel(h))}%`;
                if (h.ruin !== null || h.wonderForDevelopment !== null) {
                    const val = h.wonderForDevelopment !== null ? h.wonderForDevelopment.def.value1 : Math.max(0, Math.trunc(h.ruin!.developmentBonus * 100));
                    dev += `(${val > 0 ? '+' : ''}${val}%)`;
                }
                segs.push({ img: chromeUrl('developmentLevel.png'), gap: Math.trunc(INFO.imageSize * 0.75), title: 'Development' });
                segs.push(txt(dev, color));
                if (owner === player || flag || vis === SystemVisibilityStatus.Visible) {
                    const approval = empireApprovalRating(galaxy, h);
                    let face = approval > 15 ? 'happy.png' : approval > 0 ? 'neutral.png' : approval > -15 ? 'sad.png' : 'angry.png';
                    if (h.rebelling) face = 'angry.png';
                    segs.push({ img: chromeUrl(face), gap: Math.trunc(INFO.imageSize * 0.75), title: 'Happiness' });
                    segs.push(txt(fmtSigned(approval), color));
                }
                rows.push(label('Value', segs));
                // GDP.
                const revenue = habitatAnnualRevenue(galaxy, h);
                let gdp: string;
                if (owner !== player && !flag) {
                    gdp = revenue >= 1000 ? fmtK(revenue) : `${(revenue / 1000).toFixed(2)}K`;
                } else {
                    const empireIncome = owner.pirateEmpireBaseHabitat === null ? privateAnnualRevenue(galaxy, owner) : calculateAccurateAnnualIncome(galaxy, owner);
                    const portion = Math.max(0, empireIncome > 0 ? revenue / empireIncome : 0);
                    if (revenue < 0) gdp = `${Math.round(revenue / 1000)}K (${fmtPct(portion)} of empire GDP)`;
                    else if (revenue >= 1000) gdp = `${fmtK(revenue)} (${fmtPct(portion)} of empire GDP)`;
                    else gdp = `${(revenue / 1000).toFixed(2)}K (${(portion * 100).toFixed(2)}% of empire GDP)`;
                    gdp += ` (${fmtPct(habitatCorruption(galaxy, h))} corruption)`;
                }
                rows.push(label('GDP', [txt(gdp, color)]));
                // Tax.
                let tax: string;
                const taxRevenue = h.annualTaxRevenue;
                if (owner === player || flag) {
                    tax = fmtPct(h.taxRate);
                    if (h.rebelling) tax += ' NO TAX PAID (Rebelling)';
                    else {
                        tax += taxRevenue >= 1000 ? ` (${fmtK(taxRevenue)})` : ` (${(taxRevenue / 1000).toFixed(2)}K)`;
                        if (h.taxRate > 0) tax += ` = ${fmtPct(taxComplianceRate(galaxy, h))} compliance`;
                    }
                } else tax = `${fmtPct(h.taxRate)} (${fmtK(taxRevenue)})`;
                rows.push(label('Tax', [txt(tax, color)]));
                rows.push({ kind: 'gap', h: 4 });
            }
            // Facilities.
            rows.push(label('Facilities', facilitySegs(galaxy, h), { strip: true }));
            // Troops (InfoPanel.cs 4404-4500).
            const troops = troopItems(h.troops);
            const recruit = troopItems(h.troopsToRecruit);
            const invading = troopItems(h.invadingTroops);
            if ((h.population.totalAmount > 0 && owner !== null) || troops.length > 0 || recruit.length > 0 || invading.length > 0) {
                const own = troops.some((t) => t.empire === player) || invading.some((t) => t.empire === player);
                if (owner === player || flag || own || vis === SystemVisibilityStatus.Visible) {
                    const segs = troopSegs(troops, recruit, invading);
                    // The row's hotspot text: "Show <colony> Ground/Battle Report  (Strength: …)" (InfoPanel.cs 4419-4462).
                    const strength = troopStrengthText(h, galaxy);
                    const report: InfoTarget = { kind: 'groundReport', habitat: h };
                    rows.push(label('Troops', segs.length > 0 ? segs : [txt('(None)', color)], { alert: invading.length > 0, title: strength?.text ?? `Show ${h.name} Ground Report`, target: report }));
                    // The invasion "defend  vs  attack" row (InfoPanel.cs 4469-4499).
                    const vs = invasionVsText(h, galaxy, player);
                    if (vs !== null) rows.push(label('', [txt(vs.text)], { alert: true, title: vs.title, target: report }));
                } else rows.push(label('Troops', [txt('(Unknown)', color)]));
            }
            // Building / Docked (colonies with population).
            if (h.population.totalAmount > 0 && !independent && owner !== null) {
                const queue = h.constructionQueue as ConstructionQueue | null;
                if (queue !== null && (queue.constructionYards?.length ?? 0) > 0) {
                    if (owner === player || flag || vis === SystemVisibilityStatus.Visible) {
                        const r = buildingRow(ctx, queue);
                        if (r !== null) rows.push(r);
                        if (r !== null && owner === player) rows.push(...waitingRows(ctx, h)); // [improvements] supplyChain
                    } else rows.push(label('Building', [txt('(Unknown)', color)]));
                }
            }
            if (h.population.totalAmount > 0 && owner !== null && h.dockingBays !== null && h.dockingBays.length > 0) {
                if (owner === player || flag || vis === SystemVisibilityStatus.Visible) {
                    const r = dockedRow(ctx, h.dockingBays, h.dockingBayWaitQueue);
                    if (r !== null) rows.push(r);
                } else rows.push(label('Docked', [txt('(Unknown)', color)]));
            }
            if (owner === player) {
                const lr = luxuryRow(ctx, h); // [improvements] supplyChain
                if (lr !== null) rows.push(lr);
            }
            // Queued colony ship / bases (InfoPanel.cs 4560-4585).
            if (independent) {
                const ship = checkColonizingHabitat(player, h);
                if (ship !== null) rows.push(label('', [txt(`'${ship.name}' colonizing here`)], { wrap: true }));
                const queued = checkBasesToBeBuiltAtHabitat(player, h);
                if (queued.length > 0) rows.push(label('', [txt(`Construction ship queued to build ${resolveSubRoleDescription(queued[0].subRole)} here`)], { wrap: true }));
            }
            for (const r of threatRows(h, player)) rows.push(label(r.label, [txt(r.value)]));
        }
    } else if (h.category !== HabitatCategoryType.Star) {
        // The label band is drawn before the visibility test (InfoPanel.cs 3967-3971).
        rows.push({ kind: 'gap', h: 5 });
        rows.push({ kind: 'band' });
    }

    // Picture: the planet art at its diameter (method_54) faded 0.33; a star sits 55% off the left edge. method_54
    // draws a star's bitmap_196[MapPictureRef], a super nova's bitmap_206[NovaImageIndexMajor] (starPictureUrls).
    const isStar = h.category === HabitatCategoryType.Star;
    return {
        title,
        corner,
        picture: picture(isStar ? (starPictureUrls(h)[0] ?? null) : habitatImageUrl(h), isStar ? h.diameter : h.diameter, 0, isStar),
        rows,
        labelWidth: INFO.labelWidthHabitat - 5,
        automated: false,
    };
}

// ---------------------------------------------------------------------------------------------------------------
// System (InfoPanel.cs 4819 DrawSystemInfo + 3642 DrawSystemColoniesSummary)
// ---------------------------------------------------------------------------------------------------------------

/** DrawPopulationIndicator thresholds (InfoPanel.cs 3823). */
export function populationIndicator(totalPopulation: number, developmentLevel: number): { pop: number; dev: number } {
    let pop = 0;
    if (totalPopulation > 2500000000) pop = 5;
    else if (totalPopulation > 500000000) pop = 4;
    else if (totalPopulation > 100000000) pop = 3;
    else if (totalPopulation > 20000000) pop = 2;
    else if (totalPopulation > 0) pop = 1;
    let dev = 0;
    if (developmentLevel > 80) dev = 5;
    else if (developmentLevel > 60) dev = 4;
    else if (developmentLevel > 40) dev = 3;
    else if (developmentLevel > 20) dev = 2;
    else if (developmentLevel > 0) dev = 1;
    return { pop, dev };
}

const SUMMARY_BASE_ROLES: ReadonlySet<BuiltObjectSubRole> = new Set([
    BuiltObjectSubRole.MiningStation,
    BuiltObjectSubRole.GasMiningStation,
    BuiltObjectSubRole.ResortBase,
    BuiltObjectSubRole.EnergyResearchStation,
    BuiltObjectSubRole.WeaponsResearchStation,
    BuiltObjectSubRole.HighTechResearchStation,
    BuiltObjectSubRole.DefensiveBase,
    BuiltObjectSubRole.MonitoringStation,
    BuiltObjectSubRole.GenericBase,
]);

/** DrawSystemColoniesSummary's habitat list: the system's colonies, then habitats with a station on them. */
export function systemSummaryHabitats(galaxy: Galaxy, systemStar: Habitat): Habitat[] {
    const sys = galaxy.systems[systemStar.systemIndex];
    if (sys === undefined) return [];
    const list: Habitat[] = [];
    for (const h of sys.habitats) {
        if (h.empire !== null && h.population.dominantRace !== null && !list.includes(h)) list.push(h);
    }
    for (const h of sys.habitats) {
        const b = h.basesAtHabitat[0];
        if (b !== undefined && SUMMARY_BASE_ROLES.has(b.subRole) && !list.includes(h)) list.push(h);
    }
    return list;
}

function coloniesSummaryRow(ctx: InfoContext, systemStar: Habitat): InfoRow {
    const { galaxy } = ctx;
    const list = systemSummaryHabitats(galaxy, systemStar);
    // InfoPanel.cs 3664: as many 26 px habitats as fit in (Width - labelWidth - 10).
    const fit = Math.trunc((INFO.width - (INFO.labelWidth - 5) - 10) / INFO.habitatImageSize);
    const items: ColonySummaryItem[] = list.slice(0, fit).map((h) => {
        const base = h.basesAtHabitat[0] ?? null;
        const stationColony = base !== null && base.empire !== null && base.empire !== galaxy.independentEmpire
            && (base.subRole === BuiltObjectSubRole.MiningStation || base.subRole === BuiltObjectSubRole.GasMiningStation || base.subRole === BuiltObjectSubRole.ResortBase);
        const mining = stationColony && (base!.subRole === BuiltObjectSubRole.MiningStation || base!.subRole === BuiltObjectSubRole.GasMiningStation);
        let flagOf: Empire | null = null;
        if (!stationColony && h.empire !== null && h.empire !== galaxy.independentEmpire) flagOf = h.empire;
        else if (base !== null && base.empire !== null) flagOf = base.empire;
        const race = !stationColony ? h.population.dominantRace : null;
        const { pop, dev } = populationIndicator(h.population.totalAmount, habitatDevelopmentLevel(h));
        let resourceImg: string | null = null;
        let resourceTitle = '';
        let resourceTopic: string | null = null;
        let resourceUnknown = false;
        if (race === null && base !== null && mining) {
            if (resourcesKnown(ctx, h)) {
                const r = h.resources[0];
                const def = r !== undefined ? ctx.resource(r.resourceId) : null;
                if (def !== null) {
                    resourceImg = resourceIconUrl(def.pictureRef);
                    resourceTitle = `${def.name} (click for details)`;
                    resourceTopic = def.name;
                }
            } else resourceUnknown = true;
        }
        return {
            habitat: h,
            img: habitatImageUrl(h),
            abbr: planetTypeAbbreviation(h),
            flagOf,
            raceImg: race !== null ? raceImageUrl(race) : null,
            race,
            pop,
            dev,
            base: race === null ? base : null,
            baseImg: race === null && base !== null ? shipImageUrl(base) : null,
            resourceImg,
            resourceTitle,
            resourceTopic,
            resourceUnknown,
        };
    });
    return { kind: 'colonies', items, more: list.length > fit };
}

/** The system's resources: the star's own, then every habitat's whose resources the player knows (InfoPanel.cs
 *  4930-4960), each resource once. */
export function systemResources(ctx: InfoContext, sys: SystemInfo): { resourceId: number; abundance: number }[] {
    const out: { resourceId: number; abundance: number }[] = [];
    const seen = new Set<number>();
    const add = (list: { resourceId: number; abundance: number }[]): void => {
        for (const r of list) {
            if (seen.has(r.resourceId)) continue;
            seen.add(r.resourceId);
            out.push(r);
        }
    };
    add(sys.systemStar.resources);
    for (const h of sys.habitats) if (resourcesKnown(ctx, h)) add(h.resources);
    return out;
}

export function systemInfoModel(ctx: InfoContext, sys: SystemInfo): InfoModel {
    const { galaxy, player } = ctx;
    const star = sys.systemStar;
    const vis = systemVisibility(ctx, star.systemIndex);
    const explored = vis !== SystemVisibilityStatus.Unexplored;
    const color = explored ? WHITE : UNKNOWN_COLOR;
    const owner = checkSystemOwnership(galaxy, star).empire;
    let kind = '';
    if (star.category === HabitatCategoryType.Star && star.type !== HabitatType.BlackHole) kind = 'System';
    else if (star.category === HabitatCategoryType.GasCloud) kind = 'Gas Cloud';
    else if (star.type === HabitatType.BlackHole) kind = 'Black Hole';
    const name = star.type !== HabitatType.BlackHole ? `${star.name} ${kind}` : star.name;
    // SetData(SystemInfo): unknown grey, the owner's colour, else white.
    const titleColor = !explored ? UNKNOWN_COLOR : owner !== null ? owner.mainColor : WHITE;
    const rows: InfoRow[] = [];
    rows.push({ kind: 'gap', h: 5 - 3 });
    const typeText = star.type !== HabitatType.BlackHole ? `${habitatTypeLabel(star.type)} ${categoryLabel(star.category)}` : 'Black Hole';
    const dominantViewable = sys.dominantEmpire != null && player.empiresViewable.includes(sys.dominantEmpire.empire);
    const planets = sys.planetCount ?? sys.habitats.filter((x) => x.category === HabitatCategoryType.Planet).length;
    const moons = sys.moonCount ?? sys.habitats.filter((x) => x.category === HabitatCategoryType.Moon).length;
    const desc = (explored || dominantViewable) && star.category !== HabitatCategoryType.GasCloud ? `${typeText}, ${planets} planets, ${moons} moons` : typeText;
    rows.push({ kind: 'line', segs: [txt(desc, color)] });
    if (explored) {
        if (star.researchBonus > 0) {
            rows.push({ kind: 'gap', h: 5 });
            rows.push(label('Research', [txt(`${fmtSignedPct(star.researchBonus / 100)} bonus to ${industryLabel(star.researchBonusIndustry)} research`, color)]));
        }
        if (star.scenicFactor > 0) {
            rows.push({ kind: 'gap', h: 5 });
            rows.push(label('Scenery', [txt(fmtSignedPct(star.scenicFactor), color)]));
        }
    }
    rows.push({ kind: 'gap', h: 5 });
    // Owner: flag + name + colony icon and count.
    if (owner !== null) {
        if (explored || dominantViewable) {
            const segs: InfoSeg[] = [
                { flagOf: owner, w: INFO.flagSystem.w, h: INFO.flagSystem.h, target: { kind: 'empire', empire: owner }, title: `${owner.name} (click for details)` },
                { text: owner.name, color, gap: 2 },
            ];
            if (sys.dominantEmpire != null) {
                segs.push({ img: chromeUrl('colony.png'), gap: 10, title: 'Colonies' });
                segs.push(txt(String(sys.dominantEmpire.colonyCount), color));
            }
            rows.push(label('Owner', segs));
        } else rows.push(label('Owner', [txt('(Unknown)', color)]));
    } else rows.push(label('Owner', [txt(explored ? '(None)' : '(Unknown)', color)]));
    rows.push({ kind: 'gap', h: 6 });
    // Resource icons (no % here).
    if (explored) {
        const res = systemResources(ctx, sys);
        if (res.length === 0) rows.push(label('Resource', [txt('(None)', color)]));
        else {
            rows.push(label('Resource', res.map((r, i) => {
                const def = ctx.resource(r.resourceId);
                return { img: def ? resourceIconUrl(def.pictureRef) : undefined, gap: i > 0 ? 2 : 0, title: def?.name ?? '' };
            }), { wrap: true }));
        }
    } else rows.push(label('Resource', [txt('(Unknown)', color)]));
    rows.push({ kind: 'gap', h: INFO.rowHeight });
    if (explored) rows.push(coloniesSummaryRow(ctx, star));
    return {
        title: [{ text: explored ? name : `(Unknown ${kind})`, color: titleColor }],
        corner: null,
        // Main.Part10.cs 1422: bitmap_196[SystemStar.MapPictureRef] (a super nova's too), a gas cloud's bitmap_4.
        picture: picture(star.category !== HabitatCategoryType.GasCloud ? (mapStarUrls(star)[0] ?? null) : habitatImageUrl(star), star.diameter, 0, star.category === HabitatCategoryType.Star),
        rows,
        labelWidth: INFO.labelWidth - 5,
        automated: false,
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------------------------------------------

export interface InfoSelection {
    habitat: Habitat;
    system: SystemInfo;
    builtObject?: BuiltObject;
    shipGroup?: ShipGroup;
    creature?: Creature;
    fighter?: Fighter;
    builtObjects?: BuiltObject[];
    /** The system was selected as a whole (a star clicked at galaxy zoom: the C# SystemInfo selection). */
    systemInfo?: boolean;
}

/** InfoPanel.DrawPanel's dispatch on the selected object. */
export function buildInfoModel(ctx: InfoContext, sel: InfoSelection, creaturePicture: string | null = null, extended = false): InfoModel {
    if (sel.builtObjects !== undefined && sel.builtObjects.length > 0) return multiShipInfo(ctx, sel.builtObjects);
    if (sel.creature !== undefined) return creatureInfo(ctx, sel.creature, creaturePicture);
    if (sel.fighter !== undefined) return fighterInfo(ctx, sel.fighter);
    if (sel.shipGroup !== undefined) return shipGroupInfo(ctx, sel.shipGroup, extended);
    if (sel.builtObject !== undefined) return builtObjectInfo(ctx, sel.builtObject, extended);
    if (sel.systemInfo === true && sel.habitat === sel.system.systemStar) return systemInfoModel(ctx, sel.system);
    return habitatInfo(ctx, sel.habitat);
}

/** Flatten a model's text (tests / hover summaries). */
export function rowText(row: InfoRow): string {
    switch (row.kind) {
        case 'line':
            return row.segs.map((s) => s.text ?? '').join('');
        case 'row':
            return `${row.label}: ${row.segs.map((s) => s.text ?? '').join(' ').trim()}`;
        case 'bar':
            return `${row.label}: ${row.inner} / ${row.right}`;
        case 'colonies':
            return `colonies: ${row.items.map((i) => i.habitat.name).join(', ')}`;
        case 'grid':
            return `ships: ${row.cells.length}`;
        default:
            return '';
    }
}

/**
 * Not in the original: how far a retrofit has got, in percent, or -1 while the ship waits for a yard (null when it is not
 * at a yard at all). The yard's retrofit lists (ConstructionQueue.cs DoConstruction 566-617) shrink as components are
 * built and then scrapped; the totals are the two designs' component differences, so nothing extra is stored.
 */
export function retrofitProgressPercent(bo: BuiltObject): number | null {
    const target = bo.retrofitDesign;
    const at = bo.builtAt as { constructionQueue?: unknown } | null;
    if (target === null || at === null || at === undefined) return null;
    const queue = at.constructionQueue as { constructionYards?: Array<{ shipUnderConstruction: unknown; retrofitComponentsToBeBuilt: unknown[] | null; retrofitComponentsToBeScrapped: unknown[] | null }> | null } | null;
    const yard = queue?.constructionYards?.find((y) => y != null && y.shipUnderConstruction === bo);
    if (yard === undefined) return -1;
    const current = bo.design?.components ?? [];
    const total = componentListDiff(current, target.components).length + componentListDiff(target.components, current).length;
    if (total <= 0) return 100;
    if (yard.retrofitComponentsToBeBuilt === null) return 0;
    const remaining = yard.retrofitComponentsToBeBuilt.length + (yard.retrofitComponentsToBeScrapped?.length ?? 0);
    return Math.max(0, Math.min(100, Math.round((100 * (total - remaining)) / total)));
}
