// The research tree as DistantWorlds.Controls/ResearchTree.cs lays it out and paints it — pure geometry and state:
//   BindData (node 175 × 52, gap 60 × 20, margin 20, 28 px images), DetermineRanges, SizeControlToTreeContents,
//   CalculateNodeLocation / CalculateNodePathStart / CalculateNodePathDefaultEnd, DrawNodePaths (line colours and
//   dashes), DrawNode (glow / dull / hatched / blocked frames, queue borders, text colours, image alpha),
//   ResolveCategoryColor, GenerateNodeImages (which pictures a node shows), DrawTree / DrawProjectInfo (the hover
//   panel's size and position), UpdateColor (the current project's pulsing border), plus Main.Part6.cs method_389 (the
//   window size) and method_398 (the industry tab colours and minor text).
// The screen (researchScreen.ts) turns these into DOM; everything here is tested without a DOM.

import type { Galaxy } from '../../sim/galaxy';
import type { Race } from '../../sim/data/races';
import { ComponentType } from '../../sim/data/components';
import type { ComponentDefinition } from '../../sim/componentStatic';
import { ComponentCategoryType } from '../../sim/data/policies';
import { IndustryType } from '../../sim/types';
import { TroopType } from '../../sim/cargo';
import { BuiltObjectSubRole } from '../../sim/builtObjectTypes';
import {
    ResearchAbilityType,
    abilityRelatedSubRole,
    abilityRelatedTroopType,
    abilityTypeFromFile,
    nodeCategory,
    nodeIndustry,
    resolveComponentType,
    type ResearchSystem,
    type TechNode,
} from '../../sim/researchSystem';
import { benefitCount, countRequiredParents } from './researchBenefits';
import { HabitatImageOffsetContinental, HabitatImageOffsetDesert, HabitatImageOffsetIce, HabitatImageOffsetMarshySwamp, HabitatImageOffsetOcean, HabitatImageOffsetVolcanic, habitatImageFile } from '../../sim/galaxyImages';

/** ResearchTree.BindData sizes (original pixels). */
export const TREE = {
    nodeWidth: 175,
    nodeHeight: 52,
    gapWidth: 60,
    gapHeight: 20,
    margin: 20,
    imageSize: 28,
} as const;

// -------------------------------------------------------------------------------------------------------------------
// Window size (Main.Part6.cs method_389)
// -------------------------------------------------------------------------------------------------------------------

/** Main.Part6.cs method_389(1020, 767): the research window for a main-form ClientSize of `client`. */
export function researchWindowSize(client: { w: number; h: number }, w0 = 1020, h0 = 767): { w: number; h: number } {
    const r = client.w;
    const b = client.h;
    const w = r >= 1900 ? 1880 : r >= 1600 ? 1580 : r >= 1340 ? 1320 : r < 1280 ? w0 : 1260;
    const h = b >= 1200 ? 1180 : b >= 1080 ? 1060 : b >= 1024 ? 1000 : b < 800 ? h0 : 780;
    return { w, h };
}

// -------------------------------------------------------------------------------------------------------------------
// Layout
// -------------------------------------------------------------------------------------------------------------------

export interface TreeRanges {
    lowestTechLevel: number;
    highestTechLevel: number;
    lowestRow: number;
    highestRow: number;
}

/** The nodes ResearchTree draws for an industry: Industry == industry (TechLevel < 100 for the ranges). */
export function industryNodes(rs: ResearchSystem, industry: IndustryType): TechNode[] {
    return rs.techTree.filter((n) => nodeIndustry(n) === industry && n.def.techLevel < 100);
}

/** ResearchTree.DetermineRanges. */
export function determineRanges(nodes: readonly TechNode[]): TreeRanges {
    let lowestTechLevel = Number.MAX_SAFE_INTEGER;
    let highestTechLevel = 0;
    let lowestRow = Number.MAX_SAFE_INTEGER;
    let highestRow = 0;
    for (const n of nodes) {
        if (n.def.techLevel >= 100) continue;
        lowestTechLevel = Math.min(lowestTechLevel, n.def.techLevel);
        highestTechLevel = Math.max(highestTechLevel, n.def.techLevel);
        lowestRow = Math.min(lowestRow, n.def.row);
        highestRow = Math.max(highestRow, n.def.row);
    }
    return { lowestTechLevel, highestTechLevel, lowestRow, highestRow };
}

/** ResearchTree.SizeControlToTreeContents. */
export function treeContentSize(r: TreeRanges): { w: number; h: number } {
    if (r.highestTechLevel < r.lowestTechLevel) return { w: 0, h: 0 };
    return {
        w: TREE.margin + (r.highestTechLevel - r.lowestTechLevel + 1) * (TREE.nodeWidth + TREE.gapWidth),
        h: TREE.margin + TREE.margin + (r.highestRow - r.lowestRow + 1) * (TREE.nodeHeight + TREE.gapHeight),
    };
}

/** ResearchTree.CalculateNodeLocation (Zoom 1): column = TechLevel (− 1 when the lowest level is 1), row − 1. */
export function calculateNodeLocation(node: TechNode, r: TreeRanges): { x: number; y: number } {
    let col = Math.max(0, node.def.techLevel);
    if (r.lowestTechLevel === 1) col = Math.max(0, node.def.techLevel - 1);
    const row = Math.max(0, node.def.row - 1);
    return { x: TREE.margin + col * (TREE.nodeWidth + TREE.gapWidth), y: TREE.margin + row * (TREE.nodeHeight + TREE.gapHeight) };
}

/** DrawNodePaths: the line from parent `parentIndex` of `node` (start: the parent's right middle; end: the node's left
 *  middle, or spread over the left edge 15 px from the corners when the node has several parents). */
export function nodePath(node: TechNode, parentIndex: number, r: TreeRanges): { x1: number; y1: number; x2: number; y2: number } {
    const parent = node.parentNodes[parentIndex];
    const p = calculateNodeLocation(parent, r);
    const n = calculateNodeLocation(node, r);
    const x1 = p.x + TREE.nodeWidth;
    const y1 = p.y + Math.trunc(TREE.nodeHeight / 2);
    let y2 = n.y + Math.trunc(TREE.nodeHeight / 2);
    const count = node.parentNodes.length;
    if (count > 1) {
        const num2 = 15.0;
        const num3 = TREE.nodeHeight - num2 * 2.0;
        const num4 = Math.trunc((parentIndex / (count - 1)) * num3);
        y2 = n.y + Math.trunc(num2 + num4);
    }
    return { x1, y1, x2: n.x, y2 };
}

/** ResearchSystem.CheckNodeValidForRace (allowed and disallowed races, from Galaxy.SetResearchRaceSpecialProjects). */
export function nodeValidForRace(galaxy: Galaxy | null, node: TechNode, race: Race | null): boolean {
    const stat = galaxy?.researchStatic ?? null;
    const allowed = stat?.allowedRaces.get(node.def.projectId);
    const disallowed = stat?.disallowedRaces.get(node.def.projectId);
    let flag = true;
    if (allowed !== undefined && allowed.size > 0) flag = race !== null && allowed.has(race.name);
    if (disallowed !== undefined && disallowed.size > 0 && race !== null && disallowed.has(race.name)) flag = false;
    return flag;
}

/** The node's AllowedRaces / DisallowedRaces as Race objects (galaxy.races by name). */
export function nodeRaces(galaxy: Galaxy | null, node: TechNode): { allowed: Race[]; disallowed: Race[] } {
    const stat = galaxy?.researchStatic ?? null;
    const races = galaxy?.races ?? [];
    const pick = (names: Set<string> | undefined): Race[] => (names ? races.filter((r) => names.has(r.name)) : []);
    return { allowed: pick(stat?.allowedRaces.get(node.def.projectId)), disallowed: pick(stat?.disallowedRaces.get(node.def.projectId)) };
}

export interface PathStyle {
    /** 0xRRGGBB. */
    color: number;
    dashed: boolean;
}

/** DrawNodePaths: required parents red ((255,0,0) once the node is researched and valid, else (80,0,0)), dashed when the
 *  categories differ (or a colonization project's parent is not one); optional parents (170,170,170) / (56,56,56). */
export function pathStyle(node: TechNode, parentIndex: number, valid: boolean): PathStyle {
    const parent = node.parentNodes[parentIndex];
    const lit = node.isResearched && valid;
    if (node.parentIsRequired[parentIndex]) {
        let dashed = false;
        if (node.def.category !== parent.def.category) dashed = true;
        else if (node.def.name.toLowerCase().includes('colonization') && !parent.def.name.toLowerCase().includes('colonization')) dashed = true;
        return { color: lit ? 0xff0000 : 0x500000, dashed };
    }
    return { color: lit ? 0xaaaaaa : 0x383838, dashed: false };
}

// -------------------------------------------------------------------------------------------------------------------
// Node colours (ResolveCategoryColor) and state (DrawNode)
// -------------------------------------------------------------------------------------------------------------------

export interface NodeColors {
    back: number;
    outer: number;
    shine: number;
    glow: number;
}

const C = (back: number, outer: number, shine: number, glow: number): NodeColors => ({ back, outer, shine, glow });

/** ResearchTree.ResolveCategoryColor(category, component). */
export function resolveCategoryColor(category: ComponentCategoryType, component: Pick<ComponentDefinition, 'type' | 'value7' | 'name'> | null): NodeColors {
    switch (category) {
        case ComponentCategoryType.WeaponBeam:
        case ComponentCategoryType.WeaponSuperBeam:
            if (component !== null && (component.type === ComponentType.WeaponRailGun || component.type === ComponentType.WeaponSuperRailGun)) return C(0x608040, 0x001820, 0xa0d080, 0xc8f0b0);
            return C(0x501414, 0x200014, 0xc08094, 0xff5080);
        case ComponentCategoryType.WeaponTorpedo:
        case ComponentCategoryType.WeaponSuperTorpedo:
            if (component !== null && component.value7 > 0 && !component.name.startsWith('Shaktur')) return C(0x0a785a, 0x002018, 0x50d0b0, 0x40f0e0);
            if (component !== null && (component.type === ComponentType.WeaponMissile || component.type === ComponentType.WeaponSuperMissile)) return C(0x0a5a78, 0x001820, 0x50b0d0, 0x40c0ff);
            return C(0x40000a, 0x1e0008, 0xd02848, 0xff2040);
        case ComponentCategoryType.WeaponArea:
        case ComponentCategoryType.WeaponSuperArea:
            return C(0x403014, 0x30140a, 0xf0a050, 0xff7030);
        case ComponentCategoryType.WeaponPointDefense:
            return C(0x0a3c90, 0x001020, 0x5090d8, 0x4090ff);
        case ComponentCategoryType.WeaponIon:
            return C(0x301480, 0x200060, 0x8880e0, 0xb050ff);
        case ComponentCategoryType.WeaponGravity:
            return C(0x006060, 0x001c20, 0x14e8f0, 0x10d8ff);
        case ComponentCategoryType.Armor:
            return C(0x406070, 0x202430, 0xb0d0e8, 0xc0e0ff);
        case ComponentCategoryType.AssaultPod:
            return C(0x0c0600, 0x300000, 0xb02800, 0xff4000);
        case ComponentCategoryType.Fighter:
            return C(0x50143c, 0x200036, 0xc080c0, 0xff50f0);
        case ComponentCategoryType.Shields:
        case ComponentCategoryType.ShieldRecharge:
            return C(0x0a1450, 0x001040, 0x5070d0, 0x4060ff);
        case ComponentCategoryType.Engine:
            if (component !== null && component.type === ComponentType.EngineVectoring) return C(0x400020, 0x1e0014, 0xd02880, 0xff2070);
            return C(0x40000a, 0x1e0008, 0xd02848, 0xff2040);
        case ComponentCategoryType.HyperDrive:
            return C(0x206070, 0x0c2430, 0x60d0e8, 0x80e0ff);
        case ComponentCategoryType.HyperDisrupt:
            return C(0x207060, 0x0c3024, 0x60e8d0, 0x80ffe0);
        case ComponentCategoryType.Reactor:
            return C(0x600a40, 0x280020, 0xe050b8, 0xff40c0);
        case ComponentCategoryType.EnergyCollector:
            return C(0x3c5014, 0x182000, 0x90d050, 0xa0ff40);
        case ComponentCategoryType.Extractor:
            return C(0x503c14, 0x201800, 0xd09050, 0xffa040);
        case ComponentCategoryType.Manufacturer:
        case ComponentCategoryType.Construction:
            return C(0xffcc00, 0x332814, 0xb4a854, 0xff9900);
        case ComponentCategoryType.Storage:
            return C(0x50140a, 0x201000, 0xd07050, 0xff6040);
        case ComponentCategoryType.Sensor:
            return C(0x0a4614, 0x003010, 0x40c060, 0x50ff70);
        case ComponentCategoryType.Computer:
        case ComponentCategoryType.Labs:
            return C(0x0a1460, 0x001050, 0x5070e0, 0x4060ff);
        case ComponentCategoryType.Habitation:
            return C(0x0a3060, 0x002850, 0x50a0e0, 0x4080ff);
        default:
            return C(0x141428, 0x000014, 0x808094, 0x5050a0);
    }
}

/** DrawNode's colour lookup: the category with Components[0] (else ComponentImprovements[0]'s component). */
export function nodeColors(rs: ResearchSystem, node: TechNode): NodeColors {
    const id = node.def.components[0] ?? node.def.componentImprovements[0]?.componentId;
    const component = id !== undefined ? (rs.definitionFor(id) ?? null) : null;
    return resolveCategoryColor(nodeCategory(node), component);
}

/** Which frame DrawNode picks (CreateBackgroundFrame): glowing, or a dull one — plain, hatched (cannot be researched
 *  yet) or blocked (not for this race). */
export type NodeFrame = 'glowing' | 'dull' | 'hatched' | 'blocked';

export interface NodeVisual {
    frame: NodeFrame;
    /** Inner fill: solid outer colour, the WideDownwardDiagonal hatch, or the DarkUpwardDiagonal hatch. */
    fill: 'solid' | 'hatch-wide' | 'hatch-dark';
    /** DrawNode `enabled`: full shine, full-alpha images (else 40 % shine, 30 % images, grey text). */
    enabled: boolean;
    /** Index in the industry queue (−1 = not queued). */
    queueIndex: number;
    /** The border around the node: 3 px yellow (queued), 5 px pulsing orange→yellow (current), 5 px red (highlighted). */
    border: 'none' | 'queued' | 'current' | 'highlight';
    borderPx: number;
    /** Title colour and its drop shadow (0xAARRGGBB-free CSS strings). */
    textColor: string;
    shadowColor: string;
    /** Title: name plus " (n)" when queued. */
    title: string;
    rushing: boolean;
    /** progress / cost while 0 < progress and not researched (DrawBarGraph), else null. */
    progress: number | null;
    valid: boolean;
    canResearch: boolean;
}

/** ResearchTree.DrawNode's state (no Graphics): `hovered` = the mouse is over the node. */
export function nodeVisual(rs: ResearchSystem, node: TechNode, valid: boolean, hovered: boolean, highlighted: boolean): NodeVisual {
    const queueIndex = rs.researchQueueFor(nodeIndustry(node))?.indexOf(node) ?? -1;
    const canResearch = rs.canResearchNode(node);
    let isHovered = hovered;
    if (!canResearch) isHovered = false;
    if (node.isResearched) isHovered = true;
    // `restricted` in the C# is CheckNodeValidForRace (true = valid).
    let enabled = valid;
    if (!node.isResearched && queueIndex !== 0) enabled = false;
    if (node.isResearched) enabled = true;
    if (!valid && !node.isResearched) isHovered = false;
    const ghosted = !node.isResearched && !canResearch;
    if (queueIndex === 0) isHovered = true;
    let frame: NodeFrame;
    if (isHovered) frame = 'glowing';
    else if (!valid) frame = 'blocked';
    else if (ghosted) frame = 'hatched';
    else frame = 'dull';
    // DrawButtonBackground's fill for that frame.
    let fill: NodeVisual['fill'];
    if (ghosted) fill = valid ? 'hatch-dark' : 'hatch-wide';
    else if (!valid) fill = 'hatch-wide';
    else fill = 'solid';
    let border: NodeVisual['border'] = 'none';
    let borderPx = 0;
    if (queueIndex >= 0) {
        border = queueIndex === 0 ? 'current' : 'queued';
        borderPx = queueIndex === 0 ? 5 : 3;
    }
    if (highlighted) {
        border = queueIndex === 0 ? 'current' : 'highlight';
        borderPx = 5;
    }
    let textColor = 'rgb(170, 170, 170)';
    let shadowColor = 'rgb(48, 48, 48)';
    if (isHovered) {
        textColor = '#fff';
        shadowColor = '#000';
    } else if (!enabled) {
        textColor = 'rgb(80, 80, 80)';
        shadowColor = 'rgba(48, 48, 48, 0.5)';
    }
    const title = queueIndex >= 0 ? `${node.def.name} (${queueIndex + 1})` : node.def.name;
    const progress = node.progress > 0 && !node.isResearched ? Math.min(1, node.cost > 0 ? node.progress / node.cost : 0) : null;
    return { frame, fill, enabled, queueIndex, border, borderPx, textColor, shadowColor, title, rushing: node.isRushing && !node.isResearched, progress, valid, canResearch };
}

/** UpdateColor(normal, alternate): a 2-second triangle wave from `normal` (on the even second's start) to `alternate`
 *  and back, by the wall clock. Returns the blend factor 0..1 towards `alternate`. */
export function pulseFactor(nowMs: number): number {
    const second = Math.floor(nowMs / 1000);
    let ms = ((nowMs % 1000) + 1000) % 1000;
    if (second % 2 === 1) ms += 1000;
    return ms <= 1000 ? Math.abs(1000 - ms) / 1000.0 : (ms - 1000) / 1000.0;
}

// -------------------------------------------------------------------------------------------------------------------
// Node pictures (GenerateNodeImages)
// -------------------------------------------------------------------------------------------------------------------

export interface NodeImage {
    url: string;
    /** GenerateImprovedComponentImage: the up arrow drawn over the picture's left edge. */
    improved: boolean;
    /** RotateFlip(Rotate270FlipNone): ships and fighters face up. */
    rotate: boolean;
    /** A component bitmap (drawn as an opaque tile, as the .bmp has no alpha). */
    tile: boolean;
}

/** Main.Part6.cs method_396 (1568-1573): habitatImageCache.ObtainImageSmall(HabitatImageOffset<Type>) — the first picture
 *  of Continental, MarshySwamp, Ocean, Desert, Ice, Volcanic. */
export const HABITAT_TYPE_IMAGES: readonly string[] = [
    HabitatImageOffsetContinental,
    HabitatImageOffsetMarshySwamp,
    HabitatImageOffsetOcean,
    HabitatImageOffsetDesert,
    HabitatImageOffsetIce,
    HabitatImageOffsetVolcanic,
].map((ref) => `/assets/dwu/images/environment/${habitatImageFile(ref)}`);

export const componentImageUrl = (pictureRef: number): string => `/assets/dwu/images/ui/components/Component_${pictureRef}.bmp`;
export const facilityImageUrl = (pictureRef: number): string => `/assets/dwu/images/environment/planetaryfacilities/facility_${pictureRef}.png`;
export const plagueImageUrl = (pictureRef: number): string => `/assets/dwu/images/ui/plagues/Plague_${pictureRef}.png`;
export const raceImageUrl = (pictureIndex: number): string => `/assets/dwu/images/units/races/race_${pictureIndex}.png`;

/** What the picture resolvers need from the screen (ship / fighter / troop art helpers live in src/render). */
export interface NodeImageResolvers {
    /** ShipImageHelper.ResolveNewFighterImageIndex / ResolveNewBomberImageIndex for the player race → art URL. */
    fighterUrl(bomber: boolean): string | null;
    /** The player race's carrier / resupply ship picture (Main.Part6.cs method_395 carrierImage / resupplyShipImage). */
    shipUrl(subRole: BuiltObjectSubRole): string | null;
    /** The player race's troop picture for a troop type. */
    troopUrl(type: TroopType): string | null;
}

/** ResearchTree.GenerateNodeImages: components, improved components (with the up arrow), fighters, abilities
 *  (habitat pictures, carrier / resupply ship, troops, boarding = component 115), the facility and the plague. */
export function generateNodeImages(galaxy: Galaxy | null, rs: ResearchSystem, node: TechNode, res: NodeImageResolvers): NodeImage[] {
    const out: NodeImage[] = [];
    const comp = (id: number, improved: boolean): void => {
        const c = rs.definitionFor(id);
        if (c) out.push({ url: componentImageUrl(c.pictureRef), improved, rotate: false, tile: true });
    };
    for (const id of node.def.components) comp(id, false);
    for (const ci of node.def.componentImprovements) comp(ci.componentId, true);
    for (const id of node.def.fighters) {
        const f = galaxy?.researchStatic?.fighters.find((x) => x.fighterId === id);
        const url = res.fighterUrl(f?.type === 1);
        if (url !== null) out.push({ url, improved: false, rotate: true, tile: false });
    }
    for (const a of node.def.abilities) {
        switch (abilityTypeFromFile(a.type)) {
            case ResearchAbilityType.PopulationGrowthRate:
            case ResearchAbilityType.ColonizeHabitatType: {
                const url = HABITAT_TYPE_IMAGES[a.value - 1];
                if (url) out.push({ url, improved: abilityTypeFromFile(a.type) === ResearchAbilityType.PopulationGrowthRate, rotate: false, tile: false });
                break;
            }
            case ResearchAbilityType.EnableShipSubRole: {
                const s = abilityRelatedSubRole(a);
                if (s === BuiltObjectSubRole.Carrier || s === BuiltObjectSubRole.ResupplyShip) {
                    const url = res.shipUrl(s);
                    if (url !== null) out.push({ url, improved: false, rotate: true, tile: false });
                }
                break;
            }
            case ResearchAbilityType.Troop: {
                const t = abilityRelatedTroopType(a);
                const url = res.troopUrl(t === null || t === TroopType.Undefined ? TroopType.Infantry : t);
                if (url !== null) out.push({ url, improved: a.value !== 0, rotate: false, tile: false });
                break;
            }
            case ResearchAbilityType.Boarding:
                out.push({ url: componentImageUrl(115), improved: false, rotate: false, tile: true });
                break;
        }
    }
    const facility = rs.planetaryFacilityOf(node);
    if (facility !== null) out.push({ url: facilityImageUrl(facility.pictureRef), improved: false, rotate: false, tile: false });
    const pc = node.def.plagueChange;
    if (pc !== null) {
        const plague = galaxy?.researchStatic?.plagues[pc.plagueId];
        if (plague) out.push({ url: plagueImageUrl(plague.pictureRef), improved: false, rotate: false, tile: false });
    }
    return out;
}

// -------------------------------------------------------------------------------------------------------------------
// Hover panel (DrawTree / DrawProjectInfo)
// -------------------------------------------------------------------------------------------------------------------

/** DrawProjectInfo's column width (num6) and value offset (num7) for a benefit count. */
export function projectInfoColumns(count: number): { columnWidth: number; valueOffset: number; width: number } {
    let columnWidth = Math.trunc(TREE.nodeWidth * 1.6);
    let valueOffset = 135;
    if (count > 4) {
        columnWidth = Math.trunc(TREE.nodeWidth * 1.2);
        valueOffset = 85;
    } else if (count > 3) {
        columnWidth = Math.trunc(TREE.nodeWidth * 1.35);
        valueOffset = 100;
    }
    return { columnWidth, valueOffset, width: Math.max(columnWidth, count * columnWidth) };
}

/** DrawTree / DrawProjectInfo's estimated panel height (num14): 14 lines of 20 px plus the extra lines per case. */
export function projectInfoHeight(rs: ResearchSystem, node: TechNode, queueIndex: number, allowedCount: number, disallowedCount: number): number {
    const num3 = 20;
    const num4 = 10;
    let h = num3 * 14;
    if (queueIndex >= 0) h += num3;
    if (allowedCount > 0) h += num3;
    if (disallowedCount > 0) h += num3;
    if (node.def.componentImprovements.length > 0) h += num3 + num4;
    if (rs.planetaryFacilityOf(node) !== null) h += num3 + num4;
    switch (resolveComponentType(rs, node)) {
        case ComponentType.WeaponGravityBeam:
        case ComponentType.WeaponPhaser:
        case ComponentType.WeaponSuperPhaser:
            h += num3 * 2;
            break;
        case ComponentType.WeaponAreaGravity:
            h += Math.trunc(num3 * 4.5);
            break;
        case ComponentType.AssaultPod:
        case ComponentType.WeaponRailGun:
        case ComponentType.WeaponSuperRailGun:
            h += num3 * 3;
            break;
    }
    const req = countRequiredParents(node);
    if (req > 0) {
        if (req <= 2) h += num3 + num4;
        else if (req === 3) h += num3 * 3;
        else if (req <= 5) h += num3 * 4;
        else h += num3 * 5;
    }
    return h;
}

/** DrawTree: where the hover panel goes — under the node (centred on it, kept inside the visible area horizontally),
 *  or above it when it would run past the visible bottom (minus 50). `visible` is the scrolled viewport. */
export function projectInfoPosition(
    rs: ResearchSystem,
    node: TechNode,
    r: TreeRanges,
    visible: { left: number; top: number; width: number; height: number },
    height: number,
): { x: number; y: number } {
    const loc = calculateNodeLocation(node, r);
    const num12 = Math.trunc(TREE.nodeWidth * 1.6);
    let x = loc.x - Math.trunc((num12 - TREE.nodeWidth) / 2);
    const count = benefitCount(rs, node);
    const right = visible.left + visible.width;
    if (count > 1) {
        const over = x + count * num12 - right;
        if (over > 0) x -= over;
    }
    x = Math.max(visible.left, x);
    let y = loc.y + TREE.nodeHeight;
    const limit = visible.top + visible.height - 50;
    if (y > limit - height) y -= TREE.nodeHeight + height;
    // Kept inside the visible top (the original lets a tall panel run off the top of the view).
    y = Math.max(visible.top, y);
    return { x, y };
}

/** The node under a point of the tree (ResearchTree.DetectHoveredNode's grid test), or null. */
export function detectNodeAt(nodes: readonly TechNode[], r: TreeRanges, px: number, py: number): TechNode | null {
    const x = px - TREE.margin;
    const y = py - TREE.margin;
    if (x < 0 || y < 0) return null;
    const cw = TREE.nodeWidth + TREE.gapWidth;
    const ch = TREE.nodeHeight + TREE.gapHeight;
    if (x % cw >= TREE.nodeWidth || y % ch >= TREE.nodeHeight) return null;
    let level = Math.trunc(x / cw);
    if (r.lowestTechLevel === 1) level++;
    const row = Math.trunc(y / ch) + 1;
    return nodes.find((n) => n.def.techLevel === level && n.def.row === row) ?? null;
}

// -------------------------------------------------------------------------------------------------------------------
// Industry tabs (Main.Part6.cs method_398)
// -------------------------------------------------------------------------------------------------------------------

export interface IndustryTabStyle {
    label: string;
    outer: number;
    shine: number;
    glow: number;
}

/** method_398's button text and colours (BackColor, OuterBorderColor, ShineColor, GlowColor; GlassButton paints its
 *  fill with OuterBorderColor). */
export function industryTabStyle(industry: IndustryType): IndustryTabStyle {
    switch (industry) {
        case IndustryType.Energy:
            return { label: 'Energy & Construction', outer: 0x100020, shine: 0x7050d0, glow: 0x6040ff };
        case IndustryType.HighTech:
            return { label: 'HighTech & Industrial', outer: 0x002010, shine: 0x50d070, glow: 0x40ff60 };
        default:
            return { label: 'Weapons', outer: 0x200010, shine: 0xd05070, glow: 0xff4060 };
    }
}

/** ResearchTree OnPaint: the tree's background per industry. */
export function treeBackColor(industry: IndustryType): number {
    switch (industry) {
        case IndustryType.Weapon:
            return 0x1c0000;
        case IndustryType.Energy:
            return 0x00001c;
        case IndustryType.HighTech:
            return 0x001c00;
        default:
            return 0x000000;
    }
}
