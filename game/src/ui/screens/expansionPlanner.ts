// Expansion Planner (F3 / the top-bar btnExpansionPlanner button): a port of the original's pnlExpansionPlanner on
// the shared original-style window (originalWindow.ts). Layout: Main.Part11.cs:2364 method_160 (970 × 720 ScreenPanel:
// the deficient-resources grid ctlExpansionPlannerResources, the mode combo, the target group pnlExpansionPlannerTargetGroup
// with the filters, the HabitatPrioritizationListView grid, the available-ships combo and the two action buttons, the
// picture, the galaxy mini map and Select / Go to). Logic: Main.Part4.cs:2364 method_532 (per-mode list + filters),
// FilterOutHabitatPrioritizationList, method_533 (available ships), RyphEufuaW (action button), Main.Part11.cs:2484
// method_161 (build button), btnExpansionPlannerAction_Click / btnExpansionPlannerBuildColonyShip_Click (method_539 /
// method_540), btnExpansionPlannerGotoTarget_Click / SelectTarget_Click; the grid is HabitatPrioritizationListView.cs
// BindData, the resources grid ResourceListView.cs BindData, the map GalaxyMap.cs method_6.
//
// Orders go through the player command queue: the action button is the 'shipAction' order the ship's action menu gives
// (Colonize / Build at the habitat); "Build and Send Colony Ship" is a 'buildNewShips' purchase followed by the Colonize
// order for the new ship; "Queue nearest Construction Ship to build Mining Station here" adds the build to the empire's
// construction job board ('constructionJobAdd', habitatDispatch.ts / constructionBoard.ts), whose nearest free
// construction ship takes it.
//
// TODO(port): canColonizeBecauseAtWar — galaxy.checkEmpireTerritoryCanColonizeHabitat does not return the C# out parameter (Galaxy.cs 3613), so the "Colonization target in another empire's system" status never shows
// TODO(port): method_539 purchases the colony ship at the colony with the best queue-time × sqrt(distance) to the target (Main.Part4.cs method_539); 'buildNewShips' picks the yard like the Build Order screen does

import { abundancePercentText } from '../resourceAbundance';
import './expansionPlanner.css';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { Habitat } from '../../sim/types';
import type { BuiltObject } from '../../sim/builtObject';
import type { Ruin } from '../../sim/ruins';
import { HabitatCategoryType, HabitatType } from '../../sim/types';
import { BuiltObjectSubRole } from '../../sim/builtObjectTypes';
import { checkEmpireTechCanSurviveStorms, identifyColonizationTargetsFull } from '../../sim/civilianAI';
import {
    checkConstructionShipAndMiningStationCanSurviveStorms,
    checkEmpireTerritoryCanBuildAtHabitat,
    checkInStorm,
    checkNearPirateBase,
    checkWhetherHabitatIsDangerous,
    HabitatPrioritization,
    identifyResourceCentres,
} from '../../sim/resourceTargets';
import { identifyDeficientEmpireResources, prioritizeEmpireResourceNeeds } from '../../sim/industry';
import { canEmpireColonizeHabitat, canEmpireColonizeHabitatRange, habitatResourcesHaveSuperLuxury } from '../../sim/exploration';
import { checkColonizationLikeliness, determineResourceValue } from '../../sim/tradeItems';
import { countResourceSourcesForEmpire, fastFindNearestSpacePort } from '../../sim/stationPlacement';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, COORD_UNSET_DOUBLE } from '../../sim/missions/mission';
import { ShipAction, ShipActionType, createShipAction } from '../../sim/player/shipAction';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { PendingOnce } from '../pendingCommands';
import { jobInvalidReason } from '../../sim/player/constructionBoard';
import type { Design } from '../../sim/design';
import { findNewestCanBuild } from '../../sim/designGeneration';
import { canBuiltObjectColonizeHabitat } from '../../sim/construction/constructionQueue';
import { galaxyResourceCurrentPrices } from '../../sim/design';
import { cargoAvailable, cargoIndexOf } from '../../sim/logistics/orders';
import { ResourceGroup, resourceGroupOf } from '../../sim/resourceSystem';
import { SystemVisibilityStatus } from '../../sim/visibility';
import { formatNet, resolveGameText, tryGetText } from '../../sim/textResolver';
import {
    FONT,
    OwGrid,
    checkBox,
    dropDown,
    el,
    glassButton,
    gradientPanel,
    linkLabel,
    openOriginalWindow,
    place,
    setButtonLabel,
    setText,
    text,
    textBox,
    type GridColumn,
    type OriginalWindow,
} from '../originalWindow';
import { habitatImageUrl, shipImageUrl } from '../selectionInfo';
import { empireFlagUrl } from '../selectionInfoView';
import { racePortraitUrl } from '../empireEmblem';
import { habitatTypeLabel, resourceIconUrl, rgbCss, selectHabitat, selectStellarObject } from '../hud';
import { showToast } from '../toast';
import { mainResxImageUrl } from '../resxImage';
import { openGalactopedia } from './galactopedia';
import { openResourceLink } from './resourceComponents';
import { CROSSHAIR_COLOR, GRID_COLOR, drawMapTerritory, galaxyMapScale, sectorColumnLabel, sectorLabelStride, starBrushColor } from './galaxyMap';
import { drawGalaxyMapLayers } from './galaxyMapLayers';
import { requestSimRefresh } from '../../simworker/refresh';

/** Main.Part4.cs:2721 method_538: cmbExpansionPlannerMode index → mode key. */
export type ExpansionMode = 'colonies' | 'resourcesyou' | 'resourcesgalaxy' | 'resourcessupply';

export const EXPANSION_MODES: readonly ExpansionMode[] = ['colonies', 'resourcesyou', 'resourcesgalaxy', 'resourcessupply'];

// Main.Part3.cs:1029: cmbExpansionPlannerMode item labels, in index order.
export function expansionModeLabel(mode: ExpansionMode): string {
    switch (mode) {
        case 'colonies':
            return 'Potential Colonies';
        case 'resourcesyou':
            return 'Resource Targets by Your Empire Priority';
        case 'resourcesgalaxy':
            return 'Resource Targets by Galaxy Priority';
        case 'resourcessupply':
            return 'Your Empire Resource Locations';
    }
}

// Galaxy.2.cs:2514 ResolveDescription(HabitatCategoryType).
export function habitatCategoryDescription(category: HabitatCategoryType): string {
    switch (category) {
        case HabitatCategoryType.Asteroid:
            return 'Asteroid';
        case HabitatCategoryType.GasCloud:
            return 'Gas Cloud';
        case HabitatCategoryType.Moon:
            return 'Moon';
        case HabitatCategoryType.Planet:
            return 'Planet';
        case HabitatCategoryType.Star:
            return 'Star';
        default:
            return '';
    }
}

// HabitatPrioritizationListView.cs:279 ResolveHabitatTypeDescription.
export function habitatTypeDescription(type: HabitatType, category: HabitatCategoryType): string {
    const str1 = habitatTypeLabel(type);
    const str2 = habitatCategoryDescription(category);
    return category !== HabitatCategoryType.Asteroid || type !== HabitatType.BarrenRock ? `${str1} ${str2}` : str2;
}

// HabitatPrioritizationListView.cs:344 BuildResourcesDescription.
export function resourcesDescription(
    resources: readonly { resourceId: number; abundance: number }[],
    known: boolean,
    resourceName: (id: number) => string,
): string {
    if (!known) return '(Unknown resources)';
    if (resources.length === 0) return '(No resources)';
    return resources.map((r) => `${resourceName(r.resourceId)} (${abundancePercentText(r.abundance)})`).join(', ');
}

// HabitatPrioritizationListView.cs:605 GetResourceCellRarity.
export function resourceRarity(
    resources: readonly { resourceId: number }[],
    isSuperLuxury: (id: number) => boolean,
    isLuxury: (id: number) => boolean,
): 'VR' | 'R' | 'C' {
    if (resources.some((r) => isSuperLuxury(r.resourceId))) return 'VR';
    if (resources.some((r) => isLuxury(r.resourceId))) return 'R';
    return 'C';
}

// HabitatPrioritizationListView.cs BindData (row.Cells[9]): Ruin.Name + " (" +
// ((int)(DevelopmentBonus * 100.0)).ToString("+##0;-##0;0") + "%)".
export function ruinText(ruin: Ruin | null): string {
    if (!ruin) return '';
    const n = Math.trunc(ruin.developmentBonus * 100);
    const s = n > 0 ? `+${n}` : n < 0 ? `-${-n}` : '0';
    return `${ruin.name} (${s}%)`;
}

// HabitatPrioritizationListView.cs:60-113: Size / Distance column format "0,K" (the trailing comma scales by 1000).
export function formatThousandsK(v: number): string {
    return `${Math.round(v / 1000)}K`;
}

// HabitatPrioritizationListView.cs:60-113: Pop column format "0,,M".
export function formatMillionsM(n: number): string {
    return `${Math.round(n / 1e6)}M`;
}

// HabitatPrioritizationListView.cs:60-113: Quality column format "0%".
export function qualityPercent(q: number): string {
    return `${Math.round(q * 100)}%`;
}

// HabitatPrioritizationListView.cs:457-560: the "special ruins" test (ruin
// encountered by the player and with at least one of the seven bonuses).
export function ruinHasSpecialBonus(ruin: Ruin | null): boolean {
    if (!ruin || !ruin.playerEmpireEncountered) return false;
    return (
        ruin.bonusDefensive > 0.0 ||
        ruin.bonusDiplomacy > 0.0 ||
        ruin.bonusHappiness > 0.0 ||
        ruin.bonusResearchEnergy > 0.0 ||
        ruin.bonusResearchHighTech > 0.0 ||
        ruin.bonusResearchWeapons > 0.0 ||
        ruin.bonusWealth > 0.0
    );
}

export interface PlannerStatusInput {
    forColonization: boolean;
    /** C# flag3 (CanEmpireColonizeHabitatRange); always true when !forColonization. */
    inRange: boolean;
    specialRuins: boolean;
    superLuxuryKnown: boolean;
    inOurSystem: boolean;
    quality: number;
    nearPirateBase: boolean;
    /** C# flag4 (CheckEmpireTerritoryCanColonizeHabitat / CheckEmpireTerritoryCanBuildAtHabitat). */
    territoryOk: boolean;
    canColonizeBecauseAtWar: boolean;
    colonizationLikeliness: number;
    /** C# flag1 (CheckEmpireTechCanSurviveStorms). */
    techSurvivesStorms: boolean;
    /** C# flag2 (CheckConstructionShipAndMiningStationCanSurviveStorms). */
    shipsSurviveStorms: boolean;
    inStorm: boolean;
    dangerous: boolean;
    category: HabitatCategoryType;
}

export interface PlannerStatus {
    /** Packed RGB fore colour, or null for the default (170,170,170). */
    color: number | null;
    reason: string;
}

// HabitatPrioritizationListView.cs:457-560: row colour + tooltip ladder (first match wins).
export function plannerStatus(s: PlannerStatusInput): PlannerStatus {
    const cat = habitatCategoryDescription(s.category);
    if (!s.inRange) return { color: 0xc03030, reason: 'Too far from existing colonies' };
    if (s.specialRuins) return { color: 0x6060ff, reason: `Special ruins at this ${cat.toLowerCase()}!` };
    if (s.superLuxuryKnown) return { color: 0x6060ff, reason: `Special luxury resources at this ${cat.toLowerCase()}!` };
    if (s.forColonization && s.inOurSystem && s.quality >= 0.5) return { color: 0x00c000, reason: `${cat} is in one of our systems` };
    if (!s.forColonization && s.inOurSystem) return { color: 0x00c000, reason: `${cat} is in one of our systems` };
    if (s.nearPirateBase) return { color: 0xc0c000, reason: 'Pirate base in this system' };
    if (s.forColonization && s.territoryOk && s.canColonizeBecauseAtWar) {
        return { color: 0xc03030, reason: "Colonization target in another empire's system" };
    }
    if (!s.forColonization && !s.territoryOk) return { color: 0xc03030, reason: "Mining location in another empire's system" };
    if (s.forColonization && s.colonizationLikeliness <= -5) {
        return { color: 0xc0c000, reason: 'Colonization unlikely due to hostile population' };
    }
    if (s.forColonization && !s.techSurvivesStorms && s.inStorm) {
        return { color: 0xe08000, reason: 'Galactic storm makes colonization hazardous' };
    }
    if (!s.forColonization && !s.shipsSurviveStorms && s.inStorm) {
        return { color: 0xe08000, reason: 'Galactic storm makes construction hazardous' };
    }
    if (s.forColonization && s.quality < 0.5) return { color: 0xe08000, reason: 'Low quality makes colonization undesirable' };
    if (s.dangerous) {
        return { color: 0xc0c000, reason: 'Our last scan of this location showed nearby pirates or space monsters' };
    }
    return { color: null, reason: '' };
}

// HabitatPrioritizationListView.cs:457-470: the sim calls that feed the ladder.
// CheckNearPirateBase(Habitat, x, y) is the overload with scanRange =
// (int)(MaxSolarSystemSize * 2.1) and empireToExclude = null.
export function plannerStatusInput(galaxy: Galaxy, player: Empire, habitat: Habitat, forColonization: boolean): PlannerStatusInput {
    return {
        forColonization,
        inRange: forColonization ? canEmpireColonizeHabitatRange(galaxy, player, habitat) : true,
        specialRuins: ruinHasSpecialBonus(habitat.ruin),
        superLuxuryKnown: habitatResourcesHaveSuperLuxury(galaxy, habitat) && player.resourceMap.checkResourcesKnown(habitat),
        inOurSystem: galaxy.systems[habitat.systemIndex]?.dominantEmpire?.empire === player,
        quality: habitat.quality,
        nearPirateBase: checkNearPirateBase(galaxy, player, habitat, Math.trunc(23000 * 2.1), habitat.xpos, habitat.ypos, null),
        territoryOk: forColonization
            ? galaxy.checkEmpireTerritoryCanColonizeHabitat(player, habitat)
            : checkEmpireTerritoryCanBuildAtHabitat(galaxy, player, habitat),
        canColonizeBecauseAtWar: false,
        colonizationLikeliness: player.dominantRace ? checkColonizationLikeliness(galaxy, habitat, player.dominantRace) : 0,
        techSurvivesStorms: checkEmpireTechCanSurviveStorms(player),
        shipsSurviveStorms: checkConstructionShipAndMiningStationCanSurviveStorms(player),
        inStorm: checkInStorm(galaxy, habitat.xpos, habitat.ypos),
        dangerous: checkWhetherHabitatIsDangerous(galaxy, player, habitat),
        category: habitat.category,
    };
}

export interface ExpansionTarget {
    habitat: Habitat;
    priority: number;
    assignedShip: BuiltObject | null;
}

// Main.Part4.cs:2364 method_532: the per-mode target list.
export function expansionTargets(
    mode: ExpansionMode,
    galaxy: Galaxy,
    player: Empire,
    opts: { includeLowQuality: boolean; includeAsteroids: boolean },
): ExpansionTarget[] {
    let list: { habitat: Habitat | null; priority: number; assignedShip?: unknown }[];
    switch (mode) {
        case 'colonies':
            list = identifyColonizationTargetsFull(galaxy, player, false, 0, 5000, opts.includeLowQuality, true);
            break;
        case 'resourcesyou':
            list = prioritizeEmpireResourceNeeds(galaxy, player, true, 49, 0.001, false, opts.includeAsteroids);
            break;
        case 'resourcesgalaxy':
            list = identifyResourceCentres(galaxy, player, false, false, opts.includeAsteroids);
            break;
        case 'resourcessupply':
            list = resolveResourceSupplyLocations(galaxy, player);
            break;
    }
    const out: ExpansionTarget[] = [];
    for (const x of list) {
        if (!x.habitat) continue;
        out.push({ habitat: x.habitat, priority: x.priority, assignedShip: (x.assignedShip ?? null) as BuiltObject | null });
    }
    return out;
}

export interface ExpansionRow {
    habitat: Habitat;
    /** The list entry (HabitatPrioritization). */
    target: ExpansionTarget;
    name: string;
    /** Sort values of the numeric columns (DataGridView sorts the cell values, not the formatted text). */
    sizeValue: number;
    qualityValue: number;
    distanceValue: number;
    populationValue: number;
    type: string;
    size: string;
    quality: string;
    distance: string;
    race: string;
    population: string;
    resources: string;
    ruins: string;
    assigned: string;
    assignedTip: string;
    rarity: string;
    color: number | null;
    reason: string;
}

// HabitatPrioritizationListView.cs:375 BindData: one row.
export function expansionRow(galaxy: Galaxy, player: Empire, t: ExpansionTarget, forColonization: boolean): ExpansionRow {
    const habitat = t.habitat;
    const port = fastFindNearestSpacePort(galaxy, habitat.xpos, habitat.ypos, player);
    const distance = port !== null ? galaxy.calculateDistance(port.xpos, port.ypos, habitat.xpos, habitat.ypos) : 99999999;
    const resourceDef = (id: number) => galaxy.resourceSystem.resources[id];
    const ship = t.assignedShip;
    let assignedTip = '';
    if (ship) {
        if (ship.subRole === BuiltObjectSubRole.ColonyShip) assignedTip = `'${ship.name}' colonizing here`;
        else if (ship.subRole === BuiltObjectSubRole.ConstructionShip) assignedTip = `'${ship.name}' building mining station here`;
    }
    const { color, reason } = plannerStatus(plannerStatusInput(galaxy, player, habitat, forColonization));
    const size = Math.trunc(habitat.diameter) * 100;
    return {
        habitat,
        target: t,
        name: habitat.name,
        sizeValue: size,
        qualityValue: habitat.quality,
        distanceValue: distance,
        populationValue: habitat.population.totalAmount,
        type: habitatTypeDescription(habitat.type, habitat.category),
        size: formatThousandsK(size),
        quality: qualityPercent(habitat.quality),
        distance: formatThousandsK(distance),
        race: habitat.population.dominantRace?.name ?? '',
        population: formatMillionsM(habitat.population.totalAmount),
        resources: resourcesDescription(habitat.resources, player.resourceMap.checkResourcesKnown(habitat), (id) => resourceDef(id)?.name ?? ''),
        ruins: ruinText(habitat.ruin),
        assigned: ship?.name ?? '',
        assignedTip,
        rarity: resourceRarity(
            habitat.resources,
            (id) => (resourceDef(id)?.superLuxuryBonusAmount ?? 0) > 0,
            (id) => resourceDef(id)?.type === 2,
        ),
        color,
        reason,
    };
}

// ---------------------------------------------------------------------------
// Pure ports of the screen's logic (tested)
// ---------------------------------------------------------------------------

/** TextResolver.GetText(tag) with the English text as the fallback (headless tests load no GameText). */
function T(tag: string, english = tag): string {
    return tryGetText(tag) ?? english;
}

// HabitatPrioritizationListView.cs:457-560: each row colour's SelectionForeColor (color2 of the ladder); rows without a
// status keep the grid's (170, 170, 170) selection text.
export function plannerSelectionColor(color: number | null): number | null {
    switch (color) {
        case 0xc03030:
            return 0xff1818;
        case 0x6060ff:
            return 0x3030ff;
        case 0x00c000:
            return 0x00ff00;
        case 0xc0c000:
            return 0xffff00;
        case 0xe08000:
            return 0xff8000;
        default:
            return null;
    }
}

/** cmbExpansionPlannerResourceFilter: (All Resources), Critical Empire Resources, or one resource id. */
export type ResourceFilterValue = 'all' | 'critical' | number;

interface HasResources {
    resources: readonly { resourceId: number; abundance: number }[];
}

// Main.Part4.cs method_534 (Critical Empire Resources: a known resource of the dominant race's CriticalResources) and
// method_535 (the habitat's known resources include the selected one).
export function filterTargetsByResource<T extends { habitat: HasResources }>(
    list: readonly T[],
    filter: ResourceFilterValue,
    resourcesKnown: (h: T['habitat']) => boolean,
    criticalResourceIds: ReadonlySet<number>,
): T[] {
    if (filter === 'all') return list.slice();
    const out: T[] = [];
    for (const item of list) {
        const h = item.habitat;
        if (h.resources.length <= 0 || !resourcesKnown(h)) continue;
        if (filter === 'critical') {
            if (h.resources.some((r) => criticalResourceIds.has(r.resourceId))) out.push(item);
        } else if (h.resources.some((r) => r.resourceId === filter)) out.push(item);
    }
    return out;
}

/** HabitatPrioritizationListFilter: _chkUseResourcePercentFilter, _numResourcePercentFilter × 10, the selected resource. */
export interface PercentFilter {
    enabled: boolean;
    /** In abundance units (tenths of a percent): the numeric box × 10. */
    percentage: number;
    /** FilterType.SelectedResource with this resource, or null for FilterType.TotalResource. */
    resourceId: number | null;
}

// Main.Part4.cs FilterOutHabitatPrioritizationList. TotalResource keeps habitats without resources or whose abundances
// sum to the percentage; SelectedResource keeps habitats with at least that abundance of the resource. (The C# loop
// never advances past a habitat without the resource; method_535 has already removed those, so they are kept here.)
export function filterTargetsByPercent<T extends { habitat: HasResources }>(list: readonly T[], f: PercentFilter): T[] {
    if (!f.enabled) return list.slice();
    return list.filter(({ habitat }) => {
        if (f.resourceId === null) return habitat.resources.length === 0 || habitat.resources.reduce((s, r) => s + r.abundance, 0) >= f.percentage;
        const r = habitat.resources.find((x) => x.resourceId === f.resourceId);
        return r === undefined || r.abundance >= f.percentage;
    });
}

/** The text and Enabled of a GlassButton. */
export interface ButtonState {
    text: string;
    enabled: boolean;
}

export interface ActionInputs {
    /** The selected list entry (null: none) and whether a ship is already assigned to it. */
    target: { name: string; assigned: boolean } | null;
    /** cmbExpansionPlannerAvailableBuiltObjects.SelectedBuiltObject's name (null: none) and the item count. */
    shipName: string | null;
    shipCount: number;
    /** Galaxy.CheckEmpireTerritoryCanBuildAtHabitat(player, target). */
    canBuildHere: boolean;
    /** Empire.CanEmpireColonizeHabitatRange(player, target). */
    inRange: boolean;
}

// Port of Main.Part4.cs RyphEufuaW: btnExpansionPlannerAction's text and Enabled.
export function plannerActionState(mode: ExpansionMode, s: ActionInputs): ButtonState {
    const t = s.target;
    if (mode === 'resourcessupply') return { text: '', enabled: false };
    const resources = mode === 'resourcesyou' || mode === 'resourcesgalaxy';
    if (s.shipName !== null && t !== null && !t.assigned) {
        if (resources) {
            if (s.canBuildHere) return { text: formatNet(T('Send X to build a mining station at Y', 'Send {0} to build a mining station at {1}'), [s.shipName, t.name]), enabled: true };
            return { text: `(${T('Cannot build here')})`, enabled: false };
        }
        if (s.inRange) return { text: formatNet(T('Send X to colonize Y', 'Send {0} to colonize {1}'), [s.shipName, t.name]), enabled: true };
        return { text: T('Cannot Colonize'), enabled: false };
    }
    const kind = resources ? 'Construction' : 'Colony';
    if (resources && !(t !== null && s.canBuildHere)) return { text: `(${T('Cannot build here')})`, enabled: false };
    let text: string;
    if (s.shipCount > 0 && t !== null && !t.assigned) text = T(`No ${kind} ship selected`);
    else if (t === null) text = T(resources ? 'No resource target selected' : 'No colony target selected');
    else if (!t.assigned) text = T(`No ${kind} ships available`);
    else text = T(`${kind} Ship already assigned`);
    return { text: `(${text})`, enabled: false };
}

export interface BuildInputs {
    /** A list entry with a habitat is selected. */
    hasTarget: boolean;
    assigned: boolean;
    money: number;
    /** The newest buildable colony ship design's CalculateCurrentPurchasePrice (0 without one). */
    price: number;
    /** Empire.CanEmpireColonizeHabitat(player, target, ColonizableHabitatTypesForEmpire, newest colony ship design). */
    canColonize: boolean;
}

/** .NET `ToString("#")`: rounded, and an empty string for zero. */
export function formatHash(v: number): string {
    const n = Math.round(v);
    return n === 0 ? '' : String(n);
}

// Port of Main.Part11.cs method_161: btnExpansionPlannerBuildColonyShip's text and Enabled.
export function plannerBuildState(mode: ExpansionMode, s: BuildInputs): ButtonState {
    if (s.hasTarget && s.assigned) {
        if (mode === 'colonies') return { text: `(${T('Colony Ship already assigned')})`, enabled: false };
        if (mode === 'resourcessupply') return { text: '', enabled: false };
        return { text: `(${T('Construction Ship already assigned')})`, enabled: false };
    }
    if (mode === 'colonies') {
        if (s.money < s.price) return { text: `${T('Build and Send Colony Ship')} (${T('not enough money')})`, enabled: false };
        if (s.hasTarget && !s.canColonize) return { text: T('Cannot Build Colony Ship for this target'), enabled: false };
        return { text: `${T('Build and Send Colony Ship')} (${formatHash(s.price)} ${T('credits')})`, enabled: s.hasTarget };
    }
    if (mode === 'resourcessupply') return { text: '', enabled: false };
    return { text: T('Queue nearest Construction Ship to build Mining Station here'), enabled: s.hasTarget };
}

/** Main.Part4.cs method_532 / method_533: the per-mode texts (an empty `available` keeps the label as it was). */
export function plannerModeTexts(mode: ExpansionMode, shipsAvailable: boolean): { available: string; map: string; select: string; goto: string } {
    switch (mode) {
        case 'resourcessupply':
            return { available: '', map: T('Location of Resource Supply'), select: T('Select Resource Location'), goto: T('Go to Resource Location') };
        case 'resourcesyou':
        case 'resourcesgalaxy':
            return {
                available: T('Available Construction ships'),
                map: shipsAvailable ? T('Location of Resource Target and Construction Ship') : T('Location of Resource Target'),
                select: T('Select Resource Target'),
                goto: T('Go to Resource Target'),
            };
        case 'colonies':
            return {
                available: T('Available Colony ships'),
                map: shipsAvailable ? T('Location of Potential Colony and Colony Ship') : T('Location of Potential Colony'),
                select: T('Select Potential Colony'),
                goto: T('Go to Potential Colony'),
            };
    }
}

/** ResourceListView: Price "0.0". */
export function formatPrice(v: number): string {
    return v.toFixed(1);
}

/** ResourceListView: the amount columns (amount / 1000, format "0.0K"). */
export function formatAmountK(amount: number): string {
    return `${(amount / 1000).toFixed(1)}K`;
}

// ---------------------------------------------------------------------------
// Read-only sim queries the screen needs (not used by the sim itself)
// ---------------------------------------------------------------------------

// Port of Galaxy.7.cs:526 CountResourceSupplyForEmpire.
export function countResourceSupplyForEmpire(empire: Empire, resourceId: number): number {
    let num = 0.0;
    for (const habitat of empire.colonies) {
        if (habitat.cargo !== null && habitat.empire === empire) {
            const i = cargoIndexOf(habitat.cargo, resourceId, empire);
            if (i >= 0) num += cargoAvailable(habitat.cargo.items[i]);
        }
    }
    for (const b of empire.spacePorts) {
        if (b.cargo !== null && (b.parentHabitat === null || b.parentHabitat.empire !== empire)) {
            const i = cargoIndexOf(b.cargo, resourceId, empire);
            if (i >= 0) num += cargoAvailable(b.cargo.items[i]);
        }
    }
    for (const b of empire.miningStations) {
        if (b.cargo !== null) {
            const i = cargoIndexOf(b.cargo, resourceId, empire);
            if (i >= 0) num += cargoAvailable(b.cargo.items[i]);
        }
    }
    return num;
}

// Port of Galaxy.7.cs:512 CountResourceSupplyForGalaxy (Empires + PirateEmpires).
export function countResourceSupplyForGalaxy(galaxy: Galaxy, resourceId: number): number {
    let num = 0.0;
    for (const e of [...galaxy.empires, ...galaxy.pirateEmpires]) num += countResourceSupplyForEmpire(e, resourceId);
    return num;
}

// Port of Galaxy.1.cs:1160 CalculateResourceDemand (empire null) / 1182 CalculateResourceDemandForEmpire.
export function calculateResourceDemand(galaxy: Galaxy, resourceId: number, empire: Empire | null): { demand: number; inTransit: number } {
    let demand = 0.0;
    let inTransit = 0.0;
    const orders = galaxy.orders;
    for (let i = 0; i < orders.length; i++) {
        const order = orders.at(i);
        const r = order.commodityResource;
        if (r === null || r.resourceId !== resourceId) continue;
        if (empire !== null) {
            const byShip = order.requestingBuiltObject !== null && order.requestingBuiltObject.actualEmpire === empire;
            const byColony = order.requestingColony !== null && order.requestingColony.empire === empire;
            if (!byShip && !byColony) continue;
        }
        if (order.amountOutstandingToContract > 0) demand += order.amountOutstandingToContract;
        if (order.amountStillToArrive > 0) inTransit += order.amountStillToArrive;
    }
    return { demand, inTransit };
}

// Port of Empire.4.cs:1912 ResolveResourceSupplyLocations: the empire's colonies with resources and the parents of its
// mining stations, by DetermineResourceValue, highest first (Sort + Reverse).
export function resolveResourceSupplyLocations(galaxy: Galaxy, empire: Empire): HabitatPrioritization[] {
    const list: HabitatPrioritization[] = [];
    const has = (h: Habitat): boolean => list.some((x) => x.habitat === h);
    for (const habitat of empire.colonies) {
        if (has(habitat)) continue;
        const priority = Math.trunc(determineResourceValue(galaxy, empire, habitat));
        if (habitat.resources.length > 0) list.push(new HabitatPrioritization(habitat, priority));
    }
    for (const b of empire.miningStations) {
        const parent = b.parentHabitat;
        if (parent !== null && !has(parent)) list.push(new HabitatPrioritization(parent, Math.trunc(determineResourceValue(galaxy, empire, parent))));
    }
    list.sort((a, b) => a.priority - b.priority);
    list.reverse();
    return list;
}

/** ResourceListView's row (one deficient resource). */
export interface ResourceRow {
    resourceId: number;
    name: string;
    pictureRef: number;
    luxury: boolean;
    price: number;
    sources: number;
    stockYou: number;
    transitYou: number;
    demandYou: number;
    stockGalaxy: number;
    /** Cells 9 / 10: BindData writes the galaxy demand under "In Transit - Galaxy" and the in-transit amount under
     *  "Unfulfilled Demand - Galaxy" (kept as in the original). */
    galaxyCell9: number;
    galaxyCell10: number;
}

// Port of Main.Part11.cs:2393 (IdentifyDeficientEmpireResources(true, 0.001)) + ResourceListView.cs BindData.
export function deficientResourceRows(galaxy: Galaxy, player: Empire): ResourceRow[] {
    const prices = galaxyResourceCurrentPrices(galaxy);
    return identifyDeficientEmpireResources(galaxy, player, true, 0.001).map((r) => {
        const def = galaxy.resourceSystem.resources[r.resourceId];
        const you = calculateResourceDemand(galaxy, r.resourceId, player);
        const all = calculateResourceDemand(galaxy, r.resourceId, null);
        return {
            resourceId: r.resourceId,
            name: def?.name ?? '',
            pictureRef: def?.pictureRef ?? 0,
            luxury: r.isLuxuryResource,
            price: prices[r.resourceId] ?? 0,
            sources: countResourceSourcesForEmpire(player, r.resourceId),
            stockYou: countResourceSupplyForEmpire(player, r.resourceId),
            transitYou: you.inTransit,
            demandYou: you.demand,
            stockGalaxy: countResourceSupplyForGalaxy(galaxy, r.resourceId),
            galaxyCell9: all.demand,
            galaxyCell10: all.inTransit,
        };
    });
}

function shipIdleForPlanner(b: BuiltObject): boolean {
    const m = b.mission as { type?: number; priority?: number } | null;
    return m == null || (m.type ?? 0) === BuiltObjectMissionType.Undefined || m.priority === BuiltObjectMissionPriority.Low;
}

// Port of Main.Part4.cs method_533: the ships cmbExpansionPlannerAvailableBuiltObjects lists.
export function plannerAvailableShips(galaxy: Galaxy, player: Empire, mode: ExpansionMode, habitat: Habitat | null): BuiltObject[] {
    const all = [...player.builtObjects, ...player.privateBuiltObjects];
    switch (mode) {
        case 'resourcesyou':
        case 'resourcesgalaxy':
            return all.filter((b) => b.subRole === BuiltObjectSubRole.ConstructionShip && b.builtAt == null && shipIdleForPlanner(b));
        case 'colonies':
            if (habitat === null) return [];
            return all.filter((b) => b.subRole === BuiltObjectSubRole.ColonyShip && shipIdleForPlanner(b) && canBuiltObjectColonizeHabitat(galaxy, player, b, habitat).result);
        default:
            return [];
    }
}

// Main.Part4.cs method_540: a gas mining station when the habitat has gas resources, else a mining station.
function miningStationDesign(galaxy: Galaxy, player: Empire, habitat: Habitat): ReturnType<typeof findNewestCanBuild> {
    const gas = habitat.resources.some((r) => {
        const def = galaxy.resourceSystem.resources[r.resourceId];
        return def !== undefined && resourceGroupOf(def) === ResourceGroup.Gas;
    });
    return findNewestCanBuild(player.designs, gas ? BuiltObjectSubRole.GasMiningStation : BuiltObjectSubRole.MiningStation, player);
}

// ---------------------------------------------------------------------------
// Orders (DOM-free: the screen's buttons and the tests)
// ---------------------------------------------------------------------------

/** What a planner order's reply tells the player (a toast). */
export interface PlannerOrderReply {
    ok: boolean;
    text: string;
}

/**
 * "Cannot build here" (Main.Part4.cs 2592 / 2618, the Action / Build button text when the C# refuses the target) with
 * the reason the construction board gives (constructionBoard.ts jobInvalidReason, read on what the game shows once the
 * reply landed), e.g. "Cannot build here: Ixa III (another empire has a base at Ixa III)".
 */
export function plannerCannotBuildText(galaxy: Galaxy, player: Empire, design: Design, h: Habitat): string {
    let why: string | null = null;
    if (h.category === HabitatCategoryType.Star) why = 'mining stations cannot be built at a star';
    else {
        try {
            why = jobInvalidReason(galaxy, player, { id: 0, design, habitat: h, x: COORD_UNSET_DOUBLE, y: COORD_UNSET_DOUBLE, ship: null, active: false, basesAtStart: 0, attempts: 0 });
        } catch {
            why = null;
        }
    }
    return `${T('Cannot build here')}: ${h.name}${why !== null ? ` (${why})` : ''}`;
}

/** The player colony ship whose mission is to colonize `h` (Main.Part7.cs 885-892), or null. */
export function colonyShipAssignedTo(player: Empire, h: Habitat): BuiltObject | null {
    for (const b of player.builtObjects) {
        if (b == null || b.subRole !== BuiltObjectSubRole.ColonyShip) continue;
        const m = b.mission as { type?: number; targetHabitat?: Habitat | null } | null;
        if (m != null && m.type === BuiltObjectMissionType.Colonize && m.targetHabitat === h) return b;
    }
    return null;
}

/**
 * btnExpansionPlannerBuildColonyShip_Click in "colonies" mode: method_539(target) — buy the newest colony ship at the
 * best colony and send it to colonize `h` — as the BuildColonize order on the target (executeShipAction.ts
 * buildColonyShipFor, the same method_539, after Main.Part7.cs 883-897's check that no colony ship is on its way
 * there yet: one command, applied in the game, so even two orders reaching one boundary buy one ship). A one-shot per
 * target besides: `busy` holds it from the click until the reply (in sim-worker mode a round trip; in-thread one
 * frame) and the buttons stay off meanwhile, as the C# button is off once the target has its colony ship. Returns
 * whether the order was issued; `done` gets the reply's text.
 */
export function plannerBuildColonyShip(galaxy: Galaxy, player: Empire, h: Habitat, busy: PendingOnce<Habitat>, done: (r: PlannerOrderReply) => void): boolean {
    const design = findNewestCanBuild(player.designs, BuiltObjectSubRole.ColonyShip, player);
    if (design === null || !canEmpireColonizeHabitat(galaxy, player, player, h, player.colonizableHabitatTypesForEmpire(), design)) return false;
    // A colony ship already on its way there: the button shows "(Colony Ship already assigned)".
    if (colonyShipAssignedTo(player, h) !== null) return false;
    const end = busy.start(h);
    if (end === null) return false;
    issuePlayerCommand(galaxy, player, 'shipAction', [h, createShipAction(ShipActionType.BuildColonize, h), false], (r) => {
        end();
        // The reply's state: the ship it bought, on its way (the C# shows no message either way).
        const ship = r.ok === false ? null : colonyShipAssignedTo(player, h);
        if (ship !== null) done({ ok: true, text: formatNet(T('Send X to colonize Y', 'Send {0} to colonize {1}'), [ship.name, h.name]) });
        else done({ ok: false, text: `${T('Build and Send Colony Ship')}: ${r.ok === false && r.message ? resolveGameText(r.message) : 'not possible'}` });
    });
    return true;
}

/**
 * btnExpansionPlannerBuildColonyShip_Click in the resource modes (method_540(null, target)): a construction job for the
 * newest mining station at `h` (the port's construction board picks the ship). One-shot per target as above.
 */
export function plannerQueueMiningStation(galaxy: Galaxy, player: Empire, h: Habitat, busy: PendingOnce<Habitat>, done: (r: PlannerOrderReply) => void): boolean {
    const design = miningStationDesign(galaxy, player, h);
    if (design === null) return false;
    const end = busy.start(h);
    if (end === null) return false;
    issuePlayerCommand(galaxy, player, 'constructionJobAdd', [design, h, COORD_UNSET_DOUBLE, COORD_UNSET_DOUBLE], (id) => {
        end();
        done(id === 0 ? { ok: false, text: plannerCannotBuildText(galaxy, player, design, h) } : { ok: true, text: `Construction job added: ${design.name} at ${h.name}` });
    });
    return true;
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

export interface ExpansionPlannerOptions {
    /** The player's empire. */
    empire: Empire;
    /** Select the habitat and move the Main View to it (GotoTarget). */
    onSelect: (h: Habitat) => void;
    /** The mode to open in (method_160's argument: the colony / mining-station "Show planner" buttons); default the last one. */
    mode?: ExpansionMode;
}

interface OpenState {
    win: OriginalWindow;
    close: () => void;
}

let open: OpenState | null = null;
/** Last selected mode, kept across reopen (BaconMain.method_532_SetExpansionPlanner). */
let lastMode: ExpansionMode = 'colonies';

/** Open the Expansion Planner, or close it if it is already open (Main.Part4.cs:2974 btnExpansionPlanner_Click). */
export function toggleExpansionPlanner(opts: ExpansionPlannerOptions): void {
    if (open) open.close();
    else open = createExpansionPlanner(opts);
}

/** Close the Expansion Planner (no-op when closed). */
export function closeExpansionPlanner(): void {
    open?.close();
}

/** The window (Main.Part11.cs method_160: pnlExpansionPlanner.Size = 970 × 720). */
const WINDOW_W = 970;
const WINDOW_H = 720;

const GROUP_COLORS: [string, string, string] = ['rgb(51, 54, 61)', 'rgb(22, 21, 26)', 'rgb(51, 54, 61)'];
const ALT_CROSSHAIR = 'rgb(255, 32, 128)';
const ruinImageUrl = (pictureRef: number): string => `/assets/dwu/images/environment/ruins/ruin_${pictureRef}.png`;

function img(src: string | null, className: string, title = ''): HTMLImageElement | null {
    if (src === null) return null;
    const i = el('img', className);
    i.src = src;
    i.alt = '';
    i.draggable = false;
    if (title) i.title = title;
    return i;
}

function createExpansionPlanner(opts: ExpansionPlannerOptions): OpenState {
    const player = opts.empire;
    const galaxy = player.galaxy;
    if (opts.mode) lastMode = opts.mode;
    let mode = lastMode;
    let includeLowQuality = false;
    let includeAsteroids = false;
    let resourceFilter: ResourceFilterValue = 'all';
    let percentEnabled = false;
    let percentValue = 0;
    let rows: ExpansionRow[] = [];
    let ships: BuiltObject[] = [];
    let selectedShip: BuiltObject | null = null;
    let timer = 0;

    const win = openOriginalWindow({
        id: 'expansion',
        title: T('Expansion Planner'),
        icon: 'expansionPlanner.png',
        width: WINDOW_W,
        height: WINDOW_H,
        onClose: () => {
            window.clearInterval(timer);
            document.removeEventListener('pointerdown', closeShipList, true);
            open = null;
        },
    });
    const body = win.body;

    // ---- Resources (lblExpansionPlannerResources, btnExpansionPlannerSortResources, ctlExpansionPlannerResources) ----
    body.appendChild(place(text(T('Resources'), { size: FONT.large, bold: true, color: 'rgb(255, 255, 255)' }), 10, 11));
    let resourceGrid: OwGrid<ResourceRow> | null = null;
    const bindResources = (): void => {
        resourceGrid?.el.remove();
        resourceGrid = buildResourceGrid();
        resourceGrid.el.classList.add('ep-resources');
        resourceGrid.setRows(deficientResourceRows(galaxy, player));
        body.appendChild(place(resourceGrid.el, 10, 32, 650, 180));
    };
    // btnExpansionPlannerSortResources_Click: re-bind (the list's own order, any column sort dropped).
    body.appendChild(place(glassButton(T('Sort by Your Empire Priority'), { size: 15.83, onClick: () => bindResources() }), 460, 5, 200, 25));

    // ---- Target group (pnlExpansionPlannerTargetGroup, 660 × 404 at (5, 242)) ----
    const group = gradientPanel({ colors: GROUP_COLORS, corners: { tl: true, tr: true, br: true, bl: true }, radius: 20, borderWidth: 2, className: 'ep-group' });
    body.appendChild(place(group, 5, 242, 660, 404));

    // cmbExpansionPlannerMode (20, 230) 340 × 24, font_7, back (21, 22, 26), over the group's top edge.
    const modeSelect = dropDown(
        EXPANSION_MODES.map((m) => ({ value: m, label: expansionModeLabel(m) })),
        mode,
        (v) => {
            mode = v as ExpansionMode;
            lastMode = mode;
            refreshAll();
        },
    );
    modeSelect.classList.add('ep-mode');
    body.appendChild(place(modeSelect, 20, 230, 340, 24));

    // LrufvZylIl ("Show low-quality colonies") / chkExpansionPlannerToggleAsteroids at (15, 18).
    const lowQuality = checkBox(T('Show low-quality colonies'), false, (v) => {
        includeLowQuality = v;
        refreshAll();
    });
    const asteroids = checkBox(T('Show asteroids'), false, (v) => {
        includeAsteroids = v;
        refreshAll();
    });
    group.append(place(lowQuality, 15, 18), place(asteroids, 15, 18));

    // _chkUseResourcePercentFilter (310, 18) "Filter %" + _numResourcePercentFilter (375, 18), 30 wide.
    const pctCheck = checkBox('Filter %', false, (v) => {
        percentEnabled = v;
        refreshAll();
    });
    group.appendChild(place(pctCheck, 310, 18));
    const pctBox = textBox('0', '', (v) => {
        const n = Number.parseInt(v, 10);
        percentValue = Number.isFinite(n) && n > 0 ? n : 0;
        if (percentEnabled) refreshAll(); // numResourcePercentFilter_ValueChanged: only when the filter is on
    });
    pctBox.classList.add('ep-pct');
    pctBox.inputMode = 'numeric';
    group.appendChild(place(pctBox, 375, 16, 30, 22));

    // lblExpansionPlannerResourceFilter: method_404(…, 415, 45 × 21): right-aligned "Filter by".
    const filterLbl = text(T('Filter by'), { size: FONT.normal, color: 'rgb(255, 255, 255)', className: 'ep-filter-label' });
    group.appendChild(place(filterLbl, 395, 12, 65, 21));
    // cmbExpansionPlannerResourceFilter (465, 11) 180 × 22: (All Resources), Critical Empire Resources, resources by name.
    const resOptions = [
        { value: 'all', label: `(${T('All Resources')})` },
        { value: 'critical', label: T('Critical Empire Resources') },
        ...galaxy.resourceSystem.resources
            .map((r) => ({ value: String(r.resourceId), label: r.name }))
            .sort((a, b) => a.label.localeCompare(b.label)),
    ];
    const resSelect = dropDown(resOptions, 'all', (v) => {
        resourceFilter = v === 'all' || v === 'critical' ? v : Number(v);
        refreshAll();
    });
    resSelect.classList.add('ep-resfilter');
    group.appendChild(place(resSelect, 465, 11, 180, 22));

    // ctlExpansionPlannerTargets (10, 40) 640 × 275.
    const targetGrid = buildTargetGrid();
    targetGrid.el.classList.add('ep-targets');
    group.appendChild(place(targetGrid.el, 10, 40, 640, 275));

    // lblExpansionPlannerAvailableBuiltObjects (20, 330), cmbExpansionPlannerAvailableBuiltObjects (20, 345) 250 wide.
    const availLbl = text(T('Available Colony ships'), { size: FONT.normal, color: 'rgb(255, 255, 255)' });
    group.appendChild(place(availLbl, 20, 328));
    const shipBox = el('div', 'ep-shipbox ow-input');
    shipBox.tabIndex = 0;
    const shipList = el('div', 'ep-shiplist ow-scroll');
    shipList.style.display = 'none';
    group.append(place(shipBox, 20, 345, 250, 40), place(shipList, 20, 386, 250, 0));
    shipBox.addEventListener('click', (e) => {
        e.stopPropagation();
        if (ships.length === 0) return;
        shipList.style.display = shipList.style.display === 'none' ? '' : 'none';
    });
    function closeShipList(e: Event): void {
        if (!shipList.contains(e.target as Node) && !shipBox.contains(e.target as Node)) shipList.style.display = 'none';
    }
    document.addEventListener('pointerdown', closeShipList, true);

    // btnExpansionPlannerAction (280, 325) and btnExpansionPlannerBuildColonyShip (470, 325), 170 × 70.
    const actionBtn = glassButton('', { size: 15.83, onClick: () => doAction() });
    const buildBtn = glassButton('', { size: 15.83, onClick: () => doBuild() });
    actionBtn.classList.add('ep-wrap');
    buildBtn.classList.add('ep-wrap');
    group.append(place(actionBtn, 280, 325, 170, 70), place(buildBtn, 470, 325, 170, 70));

    // ---- Right column: picture, map, Select / Go to ----
    // picExpansionPlannerImage (675, 14) 265 × 232, SizeMode.CenterImage (a Main.resx resource read from the install).
    const pic = place(el('div', 'ep-picture'), 675, 14, 265, 232);
    body.appendChild(pic);
    void mainResxImageUrl('picExpansionPlannerImage.Image').then((u) => {
        if (u !== null) pic.style.backgroundImage = `url("${u}")`;
    });
    const mapLbl = text(T('Location in Galaxy'), { size: FONT.normal, color: 'rgb(255, 255, 255)' });
    body.appendChild(place(mapLbl, 670, 265));
    const mapCanvas = el('canvas', 'ep-map');
    body.appendChild(place(mapCanvas, 670, 282, 275, 275));
    const selectBtn = glassButton(T('Select Potential Colony'), { size: 15.83, onClick: () => selectTarget() });
    const gotoBtn = glassButton(T('Go to Potential Colony'), { size: 15.83, onClick: () => gotoTarget() });
    selectBtn.classList.add('ep-wrap');
    gotoBtn.classList.add('ep-wrap');
    body.append(place(selectBtn, 670, 567, 132, 70), place(gotoBtn, 813, 567, 132, 70));

    // ------------------------------------------------------------------------------------------------------------
    // Grids
    // ------------------------------------------------------------------------------------------------------------

    function buildResourceGrid(): OwGrid<ResourceRow> {
        const amount = (id: string, header: string, title: string, v: (r: ResourceRow) => number): GridColumn<ResourceRow> => ({
            id,
            header,
            title,
            width: 58,
            align: 'right',
            sort: v,
            render: (r, cell) => cell.append(formatAmountK(v(r))),
        });
        return new OwGrid<ResourceRow>({
            key: (r) => r.resourceId,
            rowHeight: 20,
            columns: [
                {
                    id: 'pic',
                    header: '',
                    width: 30,
                    align: 'center',
                    render: (r, cell) => {
                        const i = img(resourceIconUrl(r.pictureRef), 'ep-resicon');
                        if (i) cell.appendChild(i);
                    },
                },
                {
                    id: 'name',
                    header: T('Name'),
                    width: 110,
                    sort: (r) => r.name,
                    // Main.Part4.cs 2945 method_541: a luxury opens its Galactopedia topic, any other the Resource Components window.
                    render: (r, cell) => cell.appendChild(linkLabel(r.name, () => openResourceLink(galaxy, player, r.resourceId))),
                },
                { id: 'type', header: T('Type'), width: 56, sort: (r) => (r.luxury ? 1 : 0), render: (r, cell) => cell.append(r.luxury ? T('Luxury') : T('Strategic')) },
                { id: 'price', header: T('Price'), width: 42, align: 'right', sort: (r) => r.price, render: (r, cell) => cell.append(formatPrice(r.price)) },
                { id: 'sources', header: T('Sources'), title: T('Number of sources in your empire'), width: 62, align: 'center', sort: (r) => r.sources, render: (r, cell) => cell.append(String(r.sources)) },
                amount('stockYou', T('Your Stock'), T('Available supply in your empire'), (r) => r.stockYou),
                amount('transitYou', T('In Transit - Your Empire'), T('Amount in transit to fulfill demand in your empire'), (r) => r.transitYou),
                amount('demandYou', T('Unfulfilled Demand - Your Empire'), T('Outstanding requests in your empire'), (r) => r.demandYou),
                amount('stockGalaxy', T('Galaxy Stock'), T('Available supply in the galaxy'), (r) => r.stockGalaxy),
                amount('transitGalaxy', T('In Transit - Galaxy'), T('Amount in transit to fulfill demand in the galaxy'), (r) => r.galaxyCell9),
                amount('demandGalaxy', T('Unfulfilled Demand - Galaxy'), T('Outstanding requests in the galaxy'), (r) => r.galaxyCell10),
            ],
            empty: '',
        });
    }

    function buildTargetGrid(): OwGrid<ExpansionRow> {
        const criticalIds = new Set((player.dominantRace?.criticalResources ?? []).map((b) => b.resourceId));
        const color = (row: ExpansionRow, cell: HTMLDivElement): void => {
            if (row.color !== null) cell.style.setProperty('--ep-fg', rgbCss(row.color));
            const sel = plannerSelectionColor(row.color);
            if (sel !== null) cell.style.setProperty('--ep-sel', rgbCss(sel));
            if (row.reason) cell.title = row.reason;
        };
        // Column widths: the C# Width values (method_160), as fill weights so the twelve columns fit the 640 px grid
        // (the original's fixed widths overflow it and clip the last column).
        const col = (c: Omit<GridColumn<ExpansionRow>, 'render' | 'fill'> & { w: number; render: (r: ExpansionRow, cell: HTMLDivElement) => void }): GridColumn<ExpansionRow> => ({
            id: c.id,
            header: c.header,
            title: c.title,
            align: c.align,
            sort: c.sort,
            fill: c.w,
            render: (r, cell) => {
                color(r, cell);
                c.render(r, cell);
            },
        });
        return new OwGrid<ExpansionRow>({
            key: (r) => r.habitat,
            rowHeight: 20,
            columns: [
                col({
                    id: 'pic',
                    header: '',
                    w: 30,
                    align: 'center',
                    render: (r, cell) => {
                        const i = img(habitatImageUrl(r.habitat), 'ep-habitat');
                        if (i) cell.appendChild(i);
                    },
                }),
                col({ id: 'name', header: T('Name'), w: 100, sort: (r) => r.name, render: (r, cell) => cell.append(r.name) }),
                col({ id: 'type', header: T('Type'), w: 98, sort: (r) => r.type, render: (r, cell) => cell.append(r.type) }),
                col({ id: 'size', header: T('Size'), w: 45, align: 'right', sort: (r) => r.sizeValue, render: (r, cell) => cell.append(r.size) }),
                col({ id: 'quality', header: T('Quality'), w: 37, align: 'right', sort: (r) => r.qualityValue, render: (r, cell) => cell.append(r.quality) }),
                col({ id: 'distance', header: T('Distance'), title: T('Distance from your nearest Space Port'), w: 60, align: 'right', sort: (r) => r.distanceValue, render: (r, cell) => cell.append(r.distance) }),
                col({
                    id: 'race',
                    header: T('Race'),
                    w: 40,
                    align: 'center',
                    sort: (r) => r.race,
                    render: (r, cell) => {
                        const race = r.habitat.population.dominantRace;
                        const i = race ? img(racePortraitUrl(race.pictureIndex), 'ep-race', race.name) : null;
                        if (i) cell.appendChild(i);
                    },
                }),
                col({ id: 'pop', header: T('Population Abbreviation', 'Pop'), w: 50, align: 'right', sort: (r) => r.populationValue, render: (r, cell) => cell.append(r.population) }),
                col({
                    id: 'resources',
                    header: T('Resources'),
                    w: 95,
                    sort: (r) => r.resources,
                    render: (r, cell) => {
                        // BuildResourcesImage: the known resources' icons, 2 px apart, critical ones in a yellow dotted box.
                        cell.title = r.resources;
                        if (!player.resourceMap.checkResourcesKnown(r.habitat)) return;
                        const strip = el('div', 'ep-resstrip');
                        for (const hr of r.habitat.resources) {
                            const def = galaxy.resourceSystem.resources[hr.resourceId];
                            const i = def ? img(resourceIconUrl(def.pictureRef), `ep-resicon${criticalIds.has(hr.resourceId) ? ' ep-critical' : ''}`) : null;
                            if (i) strip.appendChild(i);
                        }
                        cell.appendChild(strip);
                    },
                }),
                col({
                    id: 'ruins',
                    header: '',
                    w: 35,
                    align: 'center',
                    sort: (r) => r.ruins,
                    render: (r, cell) => {
                        const ruin = r.habitat.ruin;
                        const i = ruin ? img(ruinImageUrl(ruin.pictureRef), 'ep-ruin', ruin.name) : null;
                        if (i) cell.appendChild(i);
                    },
                }),
                col({
                    id: 'ship',
                    header: '',
                    w: 50,
                    align: 'center',
                    sort: (r) => r.assigned,
                    render: (r, cell) => {
                        const ship = r.target.assignedShip;
                        if (!ship) return;
                        // _Grid_CellContentClick on ShipAssigned → method_555: select the ship.
                        const i = img(shipImageUrl(ship), 'ep-ship', r.assignedTip);
                        if (i) {
                            i.addEventListener('click', (e) => {
                                e.stopPropagation();
                                selectStellarObject(ship, false);
                            });
                            cell.appendChild(i);
                        }
                        cell.title = r.assignedTip;
                    },
                }),
                col({ id: 'rarity', header: '', w: 50, align: 'center', sort: (r) => r.rarity, render: (r, cell) => cell.append(r.rarity) }),
            ],
            empty: '',
            onSelect: () => onTargetChanged(),
            onDoubleClick: () => gotoTarget(),
        });
    }

    // ------------------------------------------------------------------------------------------------------------
    // Refresh (PlannerNeedRefresh: method_532 + method_533 + RyphEufuaW)
    // ------------------------------------------------------------------------------------------------------------

    const selectedRow = (): ExpansionRow | null => targetGrid.selected;

    // Main.Part4.cs method_532: the list for the mode, the resource filter, the percent filter; keep the selection.
    function bindTargets(): void {
        const forColonization = mode === 'colonies';
        lowQuality.style.display = forColonization ? '' : 'none';
        asteroids.style.display = mode === 'resourcesyou' || mode === 'resourcesgalaxy' ? '' : 'none';
        let list = expansionTargets(mode, galaxy, player, { includeLowQuality, includeAsteroids });
        const criticalIds = new Set((player.dominantRace?.criticalResources ?? []).map((b) => b.resourceId));
        list = filterTargetsByResource(list, resourceFilter, (h) => player.resourceMap.checkResourcesKnown(h as Habitat), criticalIds);
        list = filterTargetsByPercent(list, { enabled: percentEnabled, percentage: percentValue * 10, resourceId: typeof resourceFilter === 'number' ? resourceFilter : null });
        rows = list.map((t) => expansionRow(galaxy, player, t, forColonization));
        targetGrid.setRows(rows);
    }

    // Main.Part4.cs method_533: the available ships for the mode / selected target, keeping the selected ship.
    function bindShips(): void {
        const row = selectedRow();
        ships = plannerAvailableShips(galaxy, player, mode, row?.habitat ?? null);
        if (selectedShip === null || !ships.includes(selectedShip)) selectedShip = ships[0] ?? null;
        renderShipBox();
        shipList.replaceChildren();
        const visible = Math.min(6, ships.length);
        shipList.style.height = `${visible * 36 + 2}px`;
        for (const s of ships) {
            const item = el('div', `ep-shipitem${s === selectedShip ? ' ep-on' : ''}`);
            shipItemContent(item, s);
            item.addEventListener('click', () => {
                selectedShip = s;
                shipList.style.display = 'none';
                for (const x of shipList.children) x.classList.toggle('ep-on', x === item);
                renderShipBox();
                refreshButtons(); // cmbExpansionPlannerAvailableBuiltObjects_SelectedIndexChanged → RyphEufuaW
                drawMap();
            });
            shipList.appendChild(item);
        }
        if (ships.length === 0) shipList.style.display = 'none';
    }

    // BuiltObjectDropDown.OnDrawItem: the empire flag, the ship picture and the name.
    function shipItemContent(parent: HTMLElement, s: BuiltObject): void {
        parent.replaceChildren();
        const emp = s.empire as Empire | null;
        if (emp !== null && emp !== galaxy.independentEmpire) {
            const flag = el('img', 'ep-shipflag');
            flag.alt = '';
            void empireFlagUrl(galaxy, emp).then((u) => (flag.src = u));
            parent.appendChild(flag);
        }
        const pic = img(shipImageUrl(s), 'ep-shippic');
        if (pic) parent.appendChild(pic);
        parent.appendChild(el('span', 'ep-shipname', s.name));
    }

    function renderShipBox(): void {
        if (selectedShip !== null) shipItemContent(shipBox, selectedShip);
        else shipBox.replaceChildren();
    }

    function inputsFor(row: ExpansionRow | null): { action: ButtonState; build: ButtonState } {
        const h = row?.habitat ?? null;
        // Live, not only the list's snapshot (identifyColonizationTargetsFull ran when the list was built): a colony ship
        // bought with "Build and Send" gets its Colonize mission at once, so once one is on its way (or still being
        // built for it) the button stays off and a second ship can't be sent to the same target.
        const assigned =
            row !== null && (row.target.assignedShip !== null || (mode === 'colonies' && h !== null && colonyShipAssignedTo(player, h) !== null));
        const colonyDesign = findNewestCanBuild(player.designs, BuiltObjectSubRole.ColonyShip, player);
        const action = plannerActionState(mode, {
            target: row !== null ? { name: row.habitat.name, assigned } : null,
            shipName: selectedShip?.name ?? null,
            shipCount: ships.length,
            canBuildHere: h !== null && checkEmpireTerritoryCanBuildAtHabitat(galaxy, player, h),
            inRange: h !== null && canEmpireColonizeHabitatRange(galaxy, player, h),
        });
        const build = plannerBuildState(mode, {
            hasTarget: h !== null,
            assigned,
            money: player.stateMoney,
            price: colonyDesign !== null ? colonyDesign.calculateCurrentPurchasePrice(galaxy) : 0,
            canColonize: h !== null && canEmpireColonizeHabitat(galaxy, player, player, h, player.colonizableHabitatTypesForEmpire(), colonyDesign),
        });
        return { action, build };
    }

    // One order per target until its reply lands (pendingCommands.ts): a double click on Build buys one ship, and the
    // buttons stay off meanwhile (the row shows the assigned ship only with the reply).
    const busy = new PendingOnce<Habitat>();

    function refreshButtons(): void {
        const row = selectedRow();
        const { action, build } = inputsFor(row);
        setButtonLabel(actionBtn, action.text);
        actionBtn.disabled = !action.enabled;
        setButtonLabel(buildBtn, build.text);
        buildBtn.disabled = !build.enabled;
        // An order for this target is on its way (its reply re-binds the row).
        if (row !== null && busy.busy(row.habitat)) {
            actionBtn.disabled = true;
            buildBtn.disabled = true;
        }
        selectBtn.disabled = row === null;
        gotoBtn.disabled = row === null;
        const t = plannerModeTexts(mode, ships.length > 0);
        if (t.available) setText(availLbl, t.available);
        setText(mapLbl, t.map);
        setButtonLabel(selectBtn, t.select);
        setButtonLabel(gotoBtn, t.goto);
    }

    function onTargetChanged(): void {
        // ctlExpansionPlannerTargets_SelectionChanged: method_533 + RyphEufuaW.
        bindShips();
        refreshButtons();
        drawMap();
    }

    function refreshAll(): void {
        bindTargets();
        bindShips();
        refreshButtons();
        drawMap();
    }

    // ------------------------------------------------------------------------------------------------------------
    // Galaxy mini map (gmapExpansionPlanner, GalaxyMap.cs method_6 at full-galaxy zoom)
    // ------------------------------------------------------------------------------------------------------------

    function drawMap(): void {
        const W = 275;
        const dpr = Math.min(3, window.devicePixelRatio || 1) * Math.max(1, win.scale);
        const px = Math.round(W * dpr);
        if (mapCanvas.width !== px) {
            mapCanvas.width = px;
            mapCanvas.height = px;
        }
        const ctx = mapCanvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, W);
        const s = galaxyMapScale(galaxy, W);
        // GalaxyMap.cs method_6: bitmap_1 (backdrop) and bitmap_0 (nebulae), then the territory (galaxyMapLayers.ts).
        drawGalaxyMapLayers(ctx, galaxy, s, 0, 0, { onChange: () => { if (mapCanvas.isConnected) drawMap(); } });
        drawMapTerritory(ctx, galaxy, W);
        // Sector grid + labels (pen_1 / solidBrush_0).
        const secPx = galaxy.sectorSize / s;
        ctx.strokeStyle = GRID_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= galaxy.sectorWidth; i++) {
            const x = Math.trunc(i * secPx) + 0.5;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, Math.min(W, galaxy.sectorHeight * secPx));
        }
        for (let j = 0; j <= galaxy.sectorHeight; j++) {
            const y = Math.trunc(j * secPx) + 0.5;
            ctx.moveTo(0, y);
            ctx.lineTo(Math.min(W, galaxy.sectorWidth * secPx), y);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgb(96, 96, 170)';
        ctx.font = '9px Verdana, sans-serif';
        ctx.textBaseline = 'top';
        for (let i = 0; i < galaxy.sectorWidth; i += sectorLabelStride(galaxy.sectorWidth, secPx)) ctx.fillText(sectorColumnLabel(i), Math.trunc(i * secPx + secPx / 2 - 3), 2);
        for (let j = 0; j < galaxy.sectorHeight; j += sectorLabelStride(galaxy.sectorHeight, secPx)) ctx.fillText(String(j + 1), 2, Math.trunc(j * secPx + secPx / 2 - 5));
        // Systems: star-type dots, a ring in the dominant empire's colour where the player has seen it (dashed when
        // shared with other empires).
        const dot = 2;
        for (const sys of galaxy.systems) {
            const star = sys.systemStar;
            const x = star.xpos / s;
            const y = star.ypos / s;
            if (x < 0 || x > W || y < 0 || y > W) continue;
            const vis = player.visibility.checkSystemVisibilityStatus(star.systemIndex);
            const dom = sys.dominantEmpire;
            if (dom && (vis === SystemVisibilityStatus.Visible || vis === SystemVisibilityStatus.Explored)) {
                ctx.strokeStyle = rgbCss(dom.empire.mainColor);
                ctx.lineWidth = 2;
                ctx.setLineDash(sys.otherEmpires && sys.otherEmpires.length > 0 ? [4, 2] : []);
                ctx.beginPath();
                ctx.ellipse(x, y, (dot + 4) / 2, (dot + 4) / 2, 0, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
            }
            const c = starBrushColor(star);
            if (c === null) continue;
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.ellipse(x, y, dot / 2, dot / 2, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        // SetPosition (the target, pen_2) / SetPositionAlt (the selected ship, (255, 32, 128)) crosshairs.
        const cross = (wx: number, wy: number, color: string): void => {
            if (!(wx > 0 && wy > 0)) return;
            const x = Math.trunc(wx / s) + 1 + 0.5;
            const y = Math.trunc(wy / s) + 1 + 0.5;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, W);
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();
        };
        const row = selectedRow();
        if (row !== null) {
            cross(row.habitat.xpos, row.habitat.ypos, CROSSHAIR_COLOR);
            if (selectedShip !== null) cross(selectedShip.xpos, selectedShip.ypos, ALT_CROSSHAIR);
        }
    }

    // ------------------------------------------------------------------------------------------------------------
    // Actions
    // ------------------------------------------------------------------------------------------------------------

    // After an order lands (at the next frame boundary): re-bind like the C# does after each click (method_532 + 533).
    const afterOrder = (): void => {
        window.setTimeout(() => {
            if (!win.closed) refreshAll();
        }, 0);
    };

    // btnExpansionPlannerAction_Click: the selected ship builds a mining station (method_540) or colonizes the target.
    function doAction(): void {
        const row = selectedRow();
        const ship = selectedShip;
        if (row === null || ship === null) return;
        const h = row.habitat;
        let action: ShipAction;
        if (mode === 'resourcesyou' || mode === 'resourcesgalaxy') {
            const design = miningStationDesign(galaxy, player, h);
            if (design === null) return;
            // Build at the habitat with no explicit point: the mission picks the surface point (SelectRelativeHabitatSurfacePoint).
            action = ShipAction.forMissionAt(BuiltObjectMissionType.Build, h, { x: 0, y: 0 }, design);
        } else if (mode === 'colonies') {
            action = ShipAction.forMission(BuiltObjectMissionType.Colonize, h);
        } else return;
        const end = busy.start(h);
        if (end === null) return;
        refreshButtons();
        issuePlayerCommand(galaxy, player, 'shipAction', [ship, action, false], (r) => {
            end();
            if (r.ok === false) showToast(`${ship.name}: ${r.message ?? 'order refused'}`);
            afterOrder();
        });
    }

    // btnExpansionPlannerBuildColonyShip_Click: method_539 (buy a colony ship and send it) / method_540(null, target).
    function doBuild(): void {
        const row = selectedRow();
        if (row === null) return;
        const h = row.habitat;
        const replied = (r: PlannerOrderReply): void => {
            showToast(r.text);
            afterOrder();
        };
        let issued = false;
        if (mode === 'colonies') issued = plannerBuildColonyShip(galaxy, player, h, busy, replied);
        else if (mode === 'resourcesyou' || mode === 'resourcesgalaxy') issued = plannerQueueMiningStation(galaxy, player, h, busy, replied);
        if (issued) refreshButtons();
    }

    // btnExpansionPlannerSelectTarget_Click: method_208 (select, the planner stays open).
    function selectTarget(): void {
        const row = selectedRow();
        if (row !== null) selectHabitat(row.habitat, false);
    }

    // btnExpansionPlannerGotoTarget_Click: method_157 (move the view) + method_4(1.0) + method_162 (close).
    function gotoTarget(): void {
        const row = selectedRow();
        if (row === null) return;
        win.close();
        opts.onSelect(row.habitat);
    }

    bindResources();
    refreshAll();
    // Money, ship positions and queues move while the planner is open: keep the buttons and the map current.
    // Worker mode: bring what the screen shows up to date now instead of up to a cold cycle later (no-op in-thread).
    requestSimRefresh(galaxy, [player, player.colonies, player.builtObjects], () => {
        if (!win.closed) refreshAll();
    });
    timer = window.setInterval(() => {
        if (win.closed) return;
        refreshButtons();
        drawMap();
    }, 1000);

    const close = (): void => win.close();
    return { win, close };
}
