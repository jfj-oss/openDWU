// Construction Yards screen: a port of what the original's top-bar Construction Yards button opens
// (Main.Part6.cs 3243 tbtnConstructionYards_Click → method_177(null) with cmbBuiltObjectFilter = 3 "Construction
// Yards"): the Ships and Bases ScreenPanel pnlBuiltObjectInfo (Main.Part11.cs 4230 method_178, 1024 × 756) listing the
// empire's ship yards (BaconMain.cs method_423 "Construction Yards": state then private bases with a construction yard,
// then every colony) with its Construction Yards tab (Main.Part11.cs 3366 method_169): the yards (ConstructionYardListView),
// "Ships waiting to be constructed", the purchaser (ConstructionYardPurchaser: Available Funds, design picker, Purchase),
// Scrap Ship / Show Construction Summary, Move to Top / Up / Down, Remove Ship, the maximum-size text (Main.Part8.cs 808
// method_305) and "Learn about Construction...". Built on the shared original-style window (ui/originalWindow.ts).
// Our additions in the same style: list columns for the yard counts / queue / build progress, a Fleet Builds tab (fleet
// design build orders and which of their ships wait at the selected yard) and a Construction Jobs tab (the empire's
// construction job board: construction ships acting as mobile yards).
// The other pnlBuiltObjectInfo tabs (Cargo / Components / Docking Bays / Troops / Weapons, Main.Part11.cs method_170,
// method_175, method_176, method_178) are the shared pages of builtObjectDataTabs.ts; Scrap is
// btnBuiltObjectScrapSelected_Click (the 'scrapShips' op); the purchaser is yardPurchaser (also the Colonies screen's).
// The Set Fleet combo (cmbBuiltObjectSetFleet, method_182) and the manufacturing plants grids (duExoPvEoA /
// ctlConstructionYardManufacturerWaitQueue, laid out below the visible tab page in method_169: the page scrolls to them
// here) are the shared ones of builtObjectDataTabs.ts.
// The purchaser is bound as method_169 binds it (purchaserBinding): a pirate player buys at a colony it controls as itself,
// and private ships (freighters, mining ships / stations, passenger ships) too at its own bases (allowPrivateConstruction).

import './constructionYards.css';
import type { Empire } from '../../sim/empire';
import { AutomationLevel } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { BuiltObject } from '../../sim/builtObject';
import type { Design } from '../../sim/design';
import type { Habitat } from '../../sim/types';
import type { ShipGroup } from '../../sim/fleets/shipGroup';
import type { ConstructionQueue } from '../../sim/construction/constructionQueue';
import type { ConstructionYard } from '../../sim/construction/constructionYard';
import { componentListDiff, yardsCountUnderConstruction } from '../../sim/construction/constructionYard';
import { BuiltObjectSubRole } from '../../sim/builtObjectTypes';
import { BuiltObjectRole } from '../../sim/data/designSpecifications';
import { resolveSubRoleDescription, componentDefinitionsStatic } from '../../sim/designGeneration';
import { canBuildBuiltObject } from '../../sim/forceStructure';
import { determineSpacePortAtColonyIncludingUnderConstruction } from '../../sim/pirates/missionsMarket';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { moveWaitQueueItem, type WaitQueueMove } from '../../sim/player/playerOrders';
import { fleetBuildProgress, fleetDesignBook } from '../../sim/player/fleetTemplates';
import { constructionJobRows, type ConstructionJobRow } from '../../sim/player/constructionBoard';
import { builtObjectImageUrl, resolveDrawPictureRef } from '../../render/builtObjectLayer';
import { habitatImageUrl } from '../selectionInfo';
import { empireFlagUrl } from '../selectionInfoView';
import { componentImageUrl } from './researchTreeModel';
import { gt } from './researchBenefits';
import { BUILT_OBJECT_FILTERS, formatEta, retrofitToastText } from './shipsAndBasesList';
import { DIMMED_COLOR, SELECTED_COLOR, drawMapTerritory, galaxyMapScale, starDotSizes } from './galaxyMap';
import { drawGalaxyMapLayers } from './galaxyMapLayers';
import { openGalactopedia } from './galactopedia';
import { openConstructionSummary } from './designEditor';
import { builtObjectTabLabels, createSetFleetCombo, dataTabContentKey, manufacturingGrids, renderDataTab, type DataTabId } from './builtObjectDataTabs';
import { showToast } from '../toast';
import { formatNet, tryGetText } from '../../sim/textResolver';
import {
    COLORS,
    FONT,
    OwGrid,
    barGraph,
    dropDown,
    dropText,
    el,
    glassButton,
    gradientPanel,
    linkLabel,
    messageBox,
    openOriginalWindow,
    place,
    setText,
    tabStrip,
    text,
    textBox,
    valueRow,
    type OriginalWindow,
} from '../originalWindow';
import { requestSimRefresh } from '../../simworker/refresh';
// [improvements] supplyChain — the "Waiting For" tab, the Supply column and the ship rows' waiting text.
import type { Delivery, SiteSupply } from '../../sim/logistics/supplyChain';
import { supplyChainEnabled, supplySnapshot } from '../supplyChainCache';
import { deliveryText, formatEtaDays, formatUnits, itemNeedsText, itemStateText, needStatus, needStatusText, placeText, resourceName, siteHeadline, siteResourceText, type NeedStatus } from '../supplyChainText';
import { openResourceSupply, resourceSupplyAvailable } from './resourceSupply';
import { onImprovementsChange } from '../improvements';
/** The Construction Yards ship orders (the Ships and Bases buttons on the selected yard ship). */
export type YardShipOrder = 'refuelShips' | 'repairShips' | 'retireShips';

/**
 * The toast after Refuel / Repair / Retire for `bo` (`sent`: the command's result, the ships given the order). Main.Part3.cs
 * btnBuiltObjectRefuelSelected_Click / RepairSelected / RetireSelected show the result in the list's Mission column — the
 * new mission (Galaxy.ResolveDescription(Mission.Type)) or "(None)" when the ship was skipped — so the toast names the
 * mission and its destination, or says why the ship was skipped (the conditions those handlers test, read once the reply
 * landed): not a mobile ship, no damage to repair, no refuelling point / ship yard found.
 */
export function yardShipOrderText(op: YardShipOrder, bo: BuiltObject, sent: number): string {
    const what = op === 'refuelShips' ? gt('Refuel') : op === 'repairShips' ? gt('Repair') : gt('Retire');
    if (sent > 0) {
        const m = bo.mission;
        const target = m !== null && m !== undefined ? ((m as { targetStellarObject?: { name?: string } | null }).targetStellarObject ?? null) : null;
        if (!target?.name) return `${bo.name}: ${what}`;
        // GameText "Refuel at X" / "Repair at X" / "Retire at X" (the mission descriptions).
        const tag = op === 'refuelShips' ? 'Refuel at X' : op === 'repairShips' ? 'Repair at X' : 'Retire at X';
        const fallback = op === 'refuelShips' ? 'Refuel at {0}' : op === 'repairShips' ? 'Repair at {0}' : 'Retire at {0}';
        return `${bo.name}: ${formatNet(tryGetText(tag) ?? fallback, [target.name])}`;
    }
    const mobile = bo.topSpeed > 0 && bo.owner !== null && bo.role !== BuiltObjectRole.Base;
    let why: string;
    if (op === 'repairShips') why = !(bo.damagedComponentCount > 0) ? 'nothing to repair' : !(bo.topSpeed > 0) ? 'it cannot move' : 'no ship yard that can repair it was found';
    else if (!mobile) why = bo.role === BuiltObjectRole.Base ? 'bases cannot move' : 'it cannot move';
    else why = op === 'refuelShips' ? 'no refuelling point with its fuel was found' : 'no ship yard was found';
    return `${bo.name}: ${what} — ${why} (${gt('Mission')}: (${gt('None')}))`;
}

export { moveWaitQueueItem, type WaitQueueMove };

// -------------------------------------------------------------------------------------------------------------------
// Pure helpers (tested)
// -------------------------------------------------------------------------------------------------------------------

export type ConstructionSite = { kind: 'builtObject'; builtObject: BuiltObject } | { kind: 'colony'; habitat: Habitat };

/** The site's construction queue (the field is `unknown` on BuiltObject and Habitat). */
export function siteQueue(site: ConstructionSite): ConstructionQueue | null {
    return (site.kind === 'colony' ? site.habitat : site.builtObject).constructionQueue as ConstructionQueue | null;
}

/** The stellar object a site stands for. */
export function siteTarget(site: ConstructionSite): BuiltObject | Habitat {
    return site.kind === 'colony' ? site.habitat : site.builtObject;
}

// BaconMain.cs method_423, "Construction Yards" branch: state then private ship
// yards with at least one yard, then every colony.
export function constructionSites(empire: Empire): ConstructionSite[] {
    const sites: ConstructionSite[] = [];
    const addYards = (list: readonly BuiltObject[]): void => {
        for (let i = 0; i < list.length; i++) {
            const bo = list[i];
            if (!bo) continue;
            const queue = bo.constructionQueue as ConstructionQueue | null;
            if (bo.isShipYard && queue != null && (queue.constructionYards?.length ?? 0) > 0) {
                sites.push({ kind: 'builtObject', builtObject: bo });
            }
        }
    };
    addYards(empire.builtObjects);
    addYards(empire.privateBuiltObjects);
    for (let k = 0; k < empire.colonies.length; k++) sites.push({ kind: 'colony', habitat: empire.colonies[k] });
    return sites;
}

// ConstructionYardListView.cs:128 BindData, Cells[4] (Progress).
export function yardProgress(yard: ConstructionYard): number {
    const ship = yard.shipUnderConstruction;
    if (ship === null) return 0;
    if (ship.retrofitDesign !== null) {
        const design = ship.design;
        const retrofitDesign = ship.retrofitDesign;
        const num1 =
            componentListDiff(design.components, retrofitDesign.components).length +
            Math.trunc(componentListDiff(retrofitDesign.components, design.components).length / 4);
        const num2 = yard.retrofitComponentsToBeBuilt !== null ? yard.retrofitComponentsToBeBuilt.length : 0;
        const num3 = yard.retrofitComponentsToBeScrapped !== null ? yard.retrofitComponentsToBeScrapped.length : 0;
        // The C# would divide by zero here (retrofit to an identical component list).
        if (num1 === 0) return 1;
        return 1.0 - (num2 + Math.trunc(num3 / 4)) / num1;
    }
    // The C# would divide by zero here (a ship with no components).
    if (ship.components.count === 0) return 0;
    return 1.0 - ship.unbuiltOrDamagedComponentCount / ship.components.count;
}

/** .NET numeric format "p": percent with two decimals. */
export function formatProgressP(v: number): string {
    return `${(v * 100).toFixed(2)}%`;
}

export interface ConstructionSiteRow {
    site: ConstructionSite;
    name: string;
    type: string;
    /** Nearest system star's name ('(Deep Space)' for a free-flying yard). */
    system: string;
    yards: number;
    building: number;
    waiting: number;
    speed: number;
    /** Mean progress of the ships on the slipways (0 when none). */
    progress: number;
}

/** The system a site is in (BuiltObjectListView System column). */
function siteSystem(site: ConstructionSite): string {
    if (site.kind === 'colony') {
        // A colony's system: the star of its SystemIndex.
        const galaxy = (site.habitat.empire as Empire | null)?.galaxy as Galaxy | undefined;
        return galaxy?.systems[site.habitat.systemIndex]?.systemStar?.name ?? '';
    }
    return site.builtObject.nearestSystemStar?.name || '(Deep Space)';
}

/** The mean progress of the yards building something (0 when idle). */
export function siteBuildProgress(yards: readonly (ConstructionYard | null)[]): number {
    let n = 0;
    let sum = 0;
    for (const y of yards) {
        if (!y || y.componentId < 0 || y.shipUnderConstruction === null) continue;
        n++;
        sum += yardProgress(y);
    }
    return n === 0 ? 0 : sum / n;
}

// BaconMain.cs method_423 list rows, with the queue counts of each site's ConstructionQueue.
export function constructionSiteRows(empire: Empire): ConstructionSiteRow[] {
    return constructionSites(empire).map((site) => {
        const queue = siteQueue(site);
        const yards = queue?.constructionYards ?? [];
        return {
            site,
            name: site.kind === 'colony' ? site.habitat.name : site.builtObject.name,
            type: site.kind === 'colony' ? 'Colony' : resolveSubRoleDescription(site.builtObject.subRole),
            system: siteSystem(site),
            yards: queue ? yards.length : 0,
            building: queue ? yardsCountUnderConstruction(yards) : 0,
            waiting: queue ? (queue.constructionWaitQueue?.length ?? 0) : 0,
            speed: queue ? queue.constructionSpeed : 0,
            progress: queue ? siteBuildProgress(yards) : 0,
        };
    });
}

export interface YardRow {
    yard: ConstructionYard;
    /** Component name (Cells[0] tooltip). */
    name: string;
    /** Component picture ref (Cells[0]). */
    componentPicture: number;
    shipObject: BuiltObject | null;
    ship: string;
    progress: number;
    progressText: string;
    speed: number;
}

// ConstructionYardListView.cs:128 BindData: one row per yard with ComponentId >= 0
// (Cells[0] component picture + name tooltip, Cells[1] empire, Cells[2] ship picture, Cells[3] ship, Cells[4] progress, Cells[5] speed).
/** `component` gives the yard component's name and picture (or just its name: pictureRef -1). */
export function yardRows(site: ConstructionSite, component: (componentId: number) => { name: string; pictureRef: number } | string | null): YardRow[] {
    const yards = siteQueue(site)?.constructionYards ?? [];
    const rows: YardRow[] = [];
    for (const yard of yards) {
        if (!yard || yard.componentId < 0) continue;
        const progress = yardProgress(yard);
        const r = component(yard.componentId);
        const c = typeof r === 'string' ? { name: r, pictureRef: -1 } : r;
        rows.push({
            yard,
            name: c?.name ?? '',
            componentPicture: c?.pictureRef ?? -1,
            shipObject: yard.shipUnderConstruction,
            ship: yard.shipUnderConstruction !== null ? yard.shipUnderConstruction.name : '',
            progress,
            progressText: formatProgressP(progress),
            speed: yard.constructionSpeed,
        });
    }
    return rows;
}

export interface WaitRow {
    builtObject: BuiltObject;
    name: string;
    type: string;
    price: number;
}

/** "Ships waiting to be constructed" (Main.Part3.cs:699; BuiltObjectListView Name / Role), in queue order. */
export function waitRows(site: ConstructionSite): WaitRow[] {
    const wait = siteQueue(site)?.constructionWaitQueue ?? [];
    const rows: WaitRow[] = [];
    for (const bo of wait) {
        if (!bo) continue;
        rows.push({ builtObject: bo, name: bo.name, type: resolveSubRoleDescription(bo.subRole), price: bo.purchasePrice });
    }
    return rows;
}

// [improvements] supplyChain begin
export interface WaitingRow {
    key: string;
    ship: BuiltObject;
    /** The item's first row (its name is shown once). */
    first: boolean;
    shipText: string;
    state: string;
    resourceId: number | null;
    resource: string;
    missing: string;
    coming: string;
    from: string;
    eta: string;
    status: NeedStatus | 'ok';
    title: string;
    /** The soonest delivery covering it (double click selects its freighter). */
    delivery: Delivery | null;
}

/** The "Waiting For" tab's rows: per queue item (slipways, then the wait queue) one row per missing resource — how much,
 *  what is bringing it (freighters, their sources, ETA) or that nothing is — or one row when it lacks nothing. */
export function waitingRows(galaxy: Galaxy, site: SiteSupply | null): WaitingRow[] {
    const rows: WaitingRow[] = [];
    if (site === null) return rows;
    const viewer = galaxy.playerEmpire;
    site.items.forEach((item, i) => {
        const shipText = `${item.yard !== null ? '' : 'Queued: '}${item.ship.name}`;
        const state = itemStateText(item);
        const parts = `${item.componentsToBuild} components to fit: ${item.componentsReady} ready, ${item.componentsInManufacture} being made, ${item.componentsToMake} to make`;
        if (item.needs.length === 0) {
            rows.push({ key: `${i}`, ship: item.ship, first: true, shipText, state, resourceId: null, resource: '', missing: '', coming: '', from: itemNeedsText(galaxy, item), eta: '', status: 'ok', title: `${item.ship.name}: ${state}. ${parts}.`, delivery: null });
            return;
        }
        item.needs.forEach((n, j) => {
            const st = needStatus(n);
            const sr = site.resources.find((r) => r.resourceId === n.resourceId) ?? null;
            const sources = [...new Set(n.deliveries.map((d) => placeText(galaxy, d.delivery.supplier, viewer)))];
            let from = sources.join(', ');
            if (st === 'none' || n.uncovered > 0) {
                const why = sr !== null && sr.availableElsewhere > 0 ? `${formatUnits(sr.availableElsewhere)} held${sr.availableAt !== null ? ` at ${placeText(galaxy, sr.availableAt, viewer)}` : ''}, not ordered` : 'none in your empire';
                from = from === '' ? why : `${from}; rest: ${why}`;
            } else if (st === 'ordered' && from === '') from = 'ordered, waiting for a freighter';
            const coming = n.byDeliveries > 0 ? formatUnits(n.byDeliveries) : n.byOrders > 0 ? 'ordered' : 'nothing';
            const lines = [`${item.ship.name} needs ${formatUnits(n.missing)} ${resourceName(galaxy, n.resourceId)} (${needStatusText(n)}). ${parts}.`];
            for (const d of n.deliveries) lines.push(`• ${deliveryText(galaxy, d.delivery, viewer, d.amount)}`);
            if (n.byOrders > 0) lines.push(`• ${formatUnits(n.byOrders)} ordered, no freighter yet`);
            if (n.uncovered > 0) lines.push(`• ${formatUnits(n.uncovered)}: nothing coming`);
            rows.push({
                key: `${i}:${n.resourceId}`,
                ship: item.ship,
                first: j === 0,
                shipText,
                state,
                resourceId: n.resourceId,
                resource: resourceName(galaxy, n.resourceId),
                missing: formatUnits(n.missing),
                coming,
                from,
                eta: n.etaMs !== null ? formatEtaDays(n.etaMs) : n.deliveries.length > 0 ? `${formatEtaDays(n.deliveries[0].delivery.etaMs)}+` : '—',
                status: st,
                title: lines.join('\n'),
                delivery: n.deliveries[0]?.delivery ?? null,
            });
        });
    });
    return rows;
}

/** The Supply column of the site list: '' (supplied / nothing queued), 'Short', 'Stalled'. */
export function siteSupplyLabel(site: SiteSupply | null): { text: string; cls: string; title: string } {
    if (site === null || site.resources.length === 0) return { text: '', cls: '', title: site === null ? '' : 'Every queued ship has its resources' };
    if (site.stalled || site.nothingComing) return { text: site.stalled ? 'Stalled' : 'Short!', cls: 'cy-stalled', title: siteHeadline(site) };
    return { text: 'Short', cls: 'cy-short', title: siteHeadline(site) };
}
// [improvements] supplyChain end

/** Empire.10.cs 447 CheckDesignComponentsResearched. */
export function checkDesignComponentsResearched(empire: Empire, design: Design): boolean {
    for (const c of design.components) if (!empire.research.checkComponentResearched(c)) return false;
    return true;
}

const PRIVATE_SUBROLES: readonly BuiltObjectSubRole[] = [
    BuiltObjectSubRole.SmallFreighter,
    BuiltObjectSubRole.MediumFreighter,
    BuiltObjectSubRole.LargeFreighter,
    BuiltObjectSubRole.PassengerShip,
    BuiltObjectSubRole.GasMiningShip,
    BuiltObjectSubRole.MiningShip,
    BuiltObjectSubRole.GasMiningStation,
    BuiltObjectSubRole.MiningStation,
];
const SPACE_PORTS: readonly BuiltObjectSubRole[] = [BuiltObjectSubRole.SmallSpacePort, BuiltObjectSubRole.MediumSpacePort, BuiltObjectSubRole.LargeSpacePort];

/** The predicates ConstructionYardPurchaser.PopulateDesigns reads (injectable for tests). */
export interface PurchaserChecks {
    canBuild: (design: Design, colony: Habitat | null) => boolean;
    researched: (design: Design) => boolean;
    /** Galaxy.DetermineSpacePortAtColonyIncludingUnderConstruction(colony) != null. */
    colonyHasSpacePort: (colony: Habitat) => boolean;
}

export function purchaserChecks(empire: Empire): PurchaserChecks {
    return {
        canBuild: (d, colony) => canBuildBuiltObject(empire, d, colony),
        researched: (d) => checkDesignComponentsResearched(empire, d),
        colonyHasSpacePort: (c) => determineSpacePortAtColonyIncludingUnderConstruction(c) !== null,
    };
}

/**
 * ConstructionYardPurchaser.cs PopulateDesigns: the empire's current (not obsolete) designs, minus those it cannot build
 * at this yard (CanBuildBuiltObject with the colony), with unresearched components, planet destroyers, the private
 * sub-roles (state construction only), space ports at a colony that already has one, and bases at a ship / base yard.
 * Empty unless the site is a ship yard or a colony.
 */
export function purchaserDesigns(designs: readonly Design[], site: ConstructionSite, checks: PurchaserChecks, stateConstructionOnly = true): Design[] {
    const queue = siteQueue(site);
    if (queue === null) return [];
    if (site.kind === 'builtObject' && !site.builtObject.isShipYard) return [];
    const colony = site.kind === 'colony' ? site.habitat : null;
    const out: Design[] = [];
    for (const design of designs) {
        if (design.isObsolete) continue;
        if (!checks.canBuild(design, colony)) continue;
        if (!checks.researched(design)) continue;
        if (design.isPlanetDestroyer) continue;
        if (stateConstructionOnly && PRIVATE_SUBROLES.includes(design.subRole)) continue;
        if (colony !== null && SPACE_PORTS.includes(design.subRole) && checks.colonyHasSpacePort(colony)) continue;
        if (site.kind === 'builtObject' && design.role === BuiltObjectRole.Base) continue;
        out.push(design);
    }
    return out;
}

/** How method_169 binds the purchaser (ConstructionYardPurchaser.BindData's empire / allowPrivateConstruction), or null when
 *  it is not bound. */
export interface PurchaserBinding {
    /** The empire whose designs and funds the purchaser uses. */
    empire: Empire;
    /** !allowPrivateConstruction. */
    stateConstructionOnly: boolean;
}

/**
 * Port of Main.Part11.cs 3366 method_169's purchaser binding. `shipsAndBases` is bool_28: the Ships and Bases / Construction
 * Yards window (a site the player does not own is not bound; a mobile yard — TopSpeed > 0 — disables the purchaser); else the
 * Colonies window's Construction Yard tab (the colony's owner). Either way a pirate player that controls the colony
 * (PirateColonyControlList.CheckFactionHasControl) buys there as itself, and in the Ships and Bases window it may also
 * buy private ships at its own bases (allowPrivateConstruction = pirate && the site is a Base).
 */
export function purchaserBinding(player: Empire, site: ConstructionSite, shipsAndBases: boolean): PurchaserBinding | null {
    const isPirate = player.pirateEmpireBaseHabitat !== null;
    if (shipsAndBases) {
        const so = site.kind === 'colony' ? site.habitat : site.builtObject;
        if (so.empire !== player) return null;
        if (site.kind === 'builtObject' && site.builtObject.topSpeed > 0) return null;
        let empire = so.empire as Empire;
        if (isPirate && site.kind === 'colony' && site.habitat.pirateColonyControl.checkFactionHasControl(player)) empire = player;
        const allowPrivateConstruction = isPirate && site.kind === 'builtObject' && site.builtObject.role === BuiltObjectRole.Base;
        return { empire, stateConstructionOnly: !allowPrivateConstruction };
    }
    if (site.kind !== 'colony') return null;
    let empire2 = site.habitat.empire as Empire | null;
    if (isPirate && site.habitat.pirateColonyControl.checkFactionHasControl(player)) empire2 = player;
    return empire2 === null ? null : { empire: empire2, stateConstructionOnly: true };
}

/** The purchaser combo's item text: "<sub-role>: <design> (<price> credits)". */
export function purchaserLabel(design: Design, price: number): string {
    return `${resolveSubRoleDescription(design.subRole)}: ${design.name} (${gt('X credits', Math.trunc(price).toFixed(0))})`;
}

/** Main.Part8.cs 808 method_305: the maximum ship / base size text of the Construction Yards tab. */
export function maximumSizeText(sizes: { any: number; civilian: number; military: number; base: number }): string {
    let t = String(sizes.any);
    if (sizes.civilian !== sizes.any) t += `, C:${sizes.civilian}`;
    if (sizes.military !== sizes.any) t += `, M:${sizes.military}`;
    return `${gt('Maximum Ship size')}: ${t}\n${gt('Maximum Base size')}: ${sizes.base} (${gt('when not at colony')})`;
}

export function empireMaximumSizes(empire: Empire): { any: number; civilian: number; military: number; base: number } {
    return {
        any: empire.maximumConstructionSize(),
        civilian: empire.maximumConstructionSize(BuiltObjectSubRole.SmallFreighter),
        military: empire.maximumConstructionSize(BuiltObjectSubRole.Frigate),
        base: empire.maximumConstructionSizeBase(),
    };
}

/** Our fleet-design build orders: the order (by name) each queued ship belongs to. */
export function fleetOrderByShip(orders: readonly { name: string; pending: readonly BuiltObject[] }[]): Map<BuiltObject, string> {
    const m = new Map<BuiltObject, string>();
    for (const o of orders) for (const b of o.pending) if (!m.has(b)) m.set(b, o.name);
    return m;
}

/** The purchase's automation prompt (ConstructionYardPurchaser.btnPurchase_Click): the task to ask about, or null. */
export function purchaseAutomationTask(empire: Pick<Empire, 'controlColonization' | 'controlStateConstruction'>, design: Pick<Design, 'subRole'>): string | null {
    if (design.subRole === BuiltObjectSubRole.ColonyShip) return empire.controlColonization === AutomationLevel.FullyAutomated ? 'Colonization' : null;
    return empire.controlStateConstruction === AutomationLevel.FullyAutomated ? 'Ship Building' : null;
}

/** The screen's tab pages: method_178's (Cargo, Components, Construction Yards, Docking Bays, Troops, Weapons), then
 *  our Fleet Builds and Construction Jobs, and the Improvements' Waiting For (supplyChain; hidden while it is off). */
export const TAB_ORDER = ['cargo', 'components', 'yards', 'docking', 'troops', 'weapons', 'fleets', 'jobs', 'supply'] as const;
function isDataTab(t: string): t is DataTabId {
    return t === 'cargo' || t === 'components' || t === 'docking' || t === 'troops' || t === 'weapons';
}

/** Main.Part11.cs 4230 method_178 / 3366 method_169 layout, in body pixels of the 1024 × 756 ScreenPanel. */
export const YARDS_LAYOUT = {
    window: { w: 1024, h: 756 },
    list: { x: 10, y: 10, w: 680, h: 288 },
    mapTitle: { x: 700, y: 7 },
    map: { x: 700, y: 25, w: 300, h: 300 },
    buttons: { x: 10, y: 308, w: 133, h: 40, step: 135 },
    buttons2: { x: 10, y: 350, w: 133, h: 25, step: 135 },
    nameLabel: { x: 700, y: 357 },
    name: { x: 750, y: 355, w: 250, h: 20 },
    detail: { x: 700, y: 385, w: 300, h: 300 },
    tabs: { x: 10, y: 385, w: 680, h: 300 },
    /** Tab page client origin (below the 26 px strip) and size. */
    page: { x: 13, y: 413, w: 674, h: 270 },
} as const;

// -------------------------------------------------------------------------------------------------------------------
// ConstructionYardPurchaser (shared with the Colonies screen's Construction Yard tab)
// -------------------------------------------------------------------------------------------------------------------

/** A stable id per object (combo keys). */
const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;
function objectId(o: object): number {
    let id = objectIds.get(o);
    if (id === undefined) {
        id = nextObjectId++;
        objectIds.set(o, id);
    }
    return id;
}

export interface YardPurchaser {
    /** The panel (place it where the screen's layout puts the purchaser). */
    readonly el: HTMLDivElement;
    /**
     * BindData(empire, queue, colony, galaxy, allowPrivateConstruction) as method_169 binds it (purchaserBinding;
     * `shipsAndBases` = bool_28): list the designs the bound empire can build at `site` (none for null, or when the
     * binding is another empire's — it would spend that empire's funds), refresh the funds; `enabled` = Enabled.
     */
    bind(site: ConstructionSite | null, enabled: boolean, shipsAndBases: boolean): void;
}

/**
 * Port of DistantWorlds.Controls ConstructionYardPurchaser.cs (DoLayout: "Available Funds" at (10, 8) and the funds at
 * (105, 8); cmbDesigns (10, 27) Width - 20 × 21; btnPurchase (10, 56) Width - 20 × 25; PopulateDesigns;
 * btnPurchase_Click: the automation prompt, then FlashAvailableFunds when unaffordable, else the purchase), a
 * `width` × `height` GradientPanel. The purchase is the 'yardPurchase' command; `onPurchased` is PurchaseMade.
 */
export function yardPurchaser(empire: Empire, width: number, height: number, onPurchased: () => void): YardPurchaser {
    const galaxy = empire.galaxy as Galaxy;
    const panel = gradientPanel({ corners: { tl: true, tr: true, br: true, bl: true }, radius: 20, className: 'cy-purchaser' });
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
    dropText(panel, gt('Available Funds'), 10, 8, { color: COLORS.label, size: FONT.small });
    const funds = dropText(panel, '', 105, 8, { color: COLORS.label, bold: true, size: FONT.small });
    let site: ConstructionSite | null = null;
    let designs: Design[] = [];
    let designsKey = '';
    let enabled = false;
    // cmbDesigns_SelectedIndexChanged: ClearAvailableFunds.
    const designBox = dropDown([], '', () => funds.classList.remove('cy-funds-short'), 'Design to build at this yard');
    panel.appendChild(place(designBox, 10, 27, width - 20, 21));
    const btnPurchase = glassButton(gt('Purchase'), { onClick: () => void purchase() });
    panel.appendChild(place(btnPurchase, 10, 56, width - 20, 25));

    async function purchase(): Promise<void> {
        const at = site;
        const design = designs[Number(designBox.value)];
        if (!at || !design) return;
        // ConstructionYardPurchaser.btnPurchase_Click: the automation prompt first.
        const task = purchaseAutomationTask(empire, design);
        if (task !== null) {
            const b = await messageBox({
                caption: gt(task),
                text: `${gt(task)} is automated. Turn off automation so your order is not overridden?`,
                buttons: ['Turn off', 'Leave on'],
                icon: 'question',
            });
            if (b === 'Turn off') issuePlayerCommand(galaxy, empire, 'automationOff', [task]);
        }
        if (design.calculateCurrentPurchasePrice(galaxy) > empire.stateMoney) {
            funds.classList.add('cy-funds-short'); // FlashAvailableFunds
            return;
        }
        issuePlayerCommand(galaxy, empire, 'yardPurchase', [design, siteTarget(at)], (bo) => {
            if (bo === null) showToast(`${design.name}: cannot be built at ${siteTarget(at).name}`);
            setText(funds, gt('X credits', Math.trunc(empire.stateMoney).toFixed(0)));
            onPurchased();
        });
    }

    function bind(next: ConstructionSite | null, isEnabled: boolean, shipsAndBases: boolean): void {
        const binding = next === null ? null : purchaserBinding(empire, next, shipsAndBases);
        site = binding !== null && binding.empire === empire ? next : null;
        enabled = isEnabled && site !== null;
        const list = site === null || binding === null ? [] : purchaserDesigns(binding.empire.designs, site, purchaserChecks(binding.empire), binding.stateConstructionOnly);
        const prices = list.map((d) => d.calculateCurrentPurchasePrice(galaxy));
        const key = list.map((d, i) => `${objectId(d)}:${Math.trunc(prices[i])}`).join('|') + `@${next ? objectId(siteTarget(next)) : ''}`;
        if (key !== designsKey) {
            const prev = designs[Number(designBox.value)];
            designsKey = key;
            designs = list;
            designBox.replaceChildren(...list.map((d, i) => {
                const o = el('option', '', purchaserLabel(d, prices[i]));
                o.value = String(i);
                return o;
            }));
            const keep = prev ? list.indexOf(prev) : -1;
            designBox.value = String(keep >= 0 ? keep : 0);
        }
        setText(funds, gt('X credits', Math.trunc(empire.stateMoney).toFixed(0)));
        const canBuy = enabled && designs.length > 0;
        btnPurchase.disabled = !canBuy;
        designBox.disabled = !canBuy;
    }

    return { el: panel, bind };
}

// -------------------------------------------------------------------------------------------------------------------
// The screen
// -------------------------------------------------------------------------------------------------------------------

export interface ConstructionYardsOptions {
    /** The player's empire. */
    empire: Empire;
    /** Go to: select the site and move the view to it (the window closes). */
    onSelect: (target: BuiltObject | Habitat) => void;
    /** Select Ship: select it without moving the view (the window stays open). Default: onSelect. */
    onSelectOnly?: (target: BuiltObject | Habitat) => void;
    /** View Fleet. */
    onViewFleet?: (fleet: ShipGroup) => void;
    /** The header's filter combo picked another filter: open the Ships and Bases screen on it. */
    onOpenShipsAndBases?: (filter: string) => void;
    /** [improvements] supplyChain: open on this site (and tab), e.g. from the selection panel's Waiting row. */
    site?: BuiltObject | Habitat;
    tab?: 'supply' | 'yards';
}

interface OpenState {
    win: OriginalWindow;
    close: () => void;
}

let open: OpenState | null = null;

/** Open the Construction Yards screen, or close it if it is already open. */
export function toggleConstructionYards(opts: ConstructionYardsOptions): void {
    if (open) open.close();
    else open = createConstructionYards(opts);
}

/** Open the Construction Yards screen (re-opened when it is open) — on `opts.site` / `opts.tab` when given. */
export function openConstructionYards(opts: ConstructionYardsOptions): void {
    if (open) open.close();
    open = createConstructionYards(opts);
}

/** Close the Construction Yards screen (no-op when closed). */
export function closeConstructionYards(): void {
    open?.close();
}

/** Empire flag pictures (async composites), cached by empire. */
const flagUrls = new WeakMap<Empire, string | null>(); // weak: per game (a Map kept every game's empires)
let flagsVersion = 0;
function flagUrl(galaxy: Galaxy, empire: Empire | null): string | null {
    if (empire === null) return null;
    if (!flagUrls.has(empire)) {
        flagUrls.set(empire, null);
        empireFlagUrl(galaxy, empire).then(
            (u) => {
                flagUrls.set(empire, u);
                flagsVersion++;
            },
            () => undefined,
        );
    }
    return flagUrls.get(empire) ?? null;
}

function img(url: string | null, cls: string, title = ''): HTMLElement {
    if (url === null) return el('span', cls);
    const i = el('img', cls);
    i.src = url;
    i.alt = '';
    i.draggable = false;
    if (title) i.title = title;
    return i;
}

export function shipPictureUrl(bo: BuiltObject): string | null {
    // ConstructionYardListView: the retrofit design's picture while a retrofit is under way.
    if (bo.retrofitDesign !== null) return builtObjectImageUrl(bo.retrofitDesign.pictureRef);
    return builtObjectImageUrl(resolveDrawPictureRef(bo));
}

function sitePictureUrl(site: ConstructionSite): string | null {
    return site.kind === 'colony' ? habitatImageUrl(site.habitat) : shipPictureUrl(site.builtObject);
}

/** The progress cell: the DataGridViewTextBoxDropShadowCell bar under the "p" formatted value. */
export function progressCell(cell: HTMLDivElement, progress: number, width: number, shown: boolean, h: number): void {
    if (!shown) return;
    cell.appendChild(barGraph(progress, 1, width, h, 'rgb(96, 192, 96)'));
    cell.appendChild(el('span', 'cy-cell-text', formatProgressP(progress)));
}

function createConstructionYards(opts: ConstructionYardsOptions): OpenState {
    const { empire } = opts;
    const galaxy = empire.galaxy as Galaxy;
    const L = YARDS_LAYOUT;
    const componentDefs = componentDefinitionsStatic(galaxy);
    const component = (id: number): { name: string; pictureRef: number } | null => {
        const d = componentDefs[id]?.componentId === id ? componentDefs[id] : componentDefs.find((x) => x.componentId === id);
        return d ? { name: d.name, pictureRef: d.pictureRef } : null;
    };

    let timer = 0;
    const win = openOriginalWindow({
        id: 'yards',
        title: gt('Ships and Bases'),
        icon: 'shipsAndBases.png',
        width: L.window.w,
        height: L.window.h,
        onClose: () => {
            window.clearInterval(timer);
            offImprovements();
            open = null;
        },
    });
    const body = win.body;
    // [improvements] supplyChain switched off while open: leave its tab (refresh hides the tab button).
    const offImprovements = onImprovementsChange((id, on) => {
        if (id !== 'supplyChain') return;
        if (!on && tab === 'supply') tabButtons[TAB_ORDER.indexOf('yards')].click();
        refresh();
    });

    // cmbBuiltObjectFilter in the header at (380, 12), 210 × 21, on "Construction Yards".
    const header = win.frame.querySelector<HTMLElement>('.ow-header');
    const filter = dropDown(
        BUILT_OBJECT_FILTERS.map((f) => ({ value: f, label: gt(f) })),
        'Construction Yards',
        (v) => {
            if (v === 'Construction Yards') return;
            if (opts.onOpenShipsAndBases) {
                win.close();
                opts.onOpenShipsAndBases(v);
            } else filter.value = 'Construction Yards';
        },
        'Show only ships and bases of one role',
    );
    filter.classList.add('cy-filter');
    if (header) header.appendChild(place(filter, 380, 12, 210, 21));

    // ---- State (by object identity across refreshes) ----
    let rows: ConstructionSiteRow[] = [];
    let selected: ConstructionSite | null = opts.site ? (constructionSites(empire).find((x) => siteTarget(x) === opts.site) ?? null) : null;
    let selectedYard: ConstructionYard | null = null;
    let selectedWait: BuiltObject | null = null;
    // [improvements] supplyChain: the Waiting For tab and the Supply column exist while the improvement is on.
    const supplyOn = supplyChainEnabled();
    let tab: DataTabId | 'yards' | 'fleets' | 'jobs' | 'supply' = opts.tab === 'supply' && supplyOn ? 'supply' : 'yards';
    /** The selected site's supply (the shared snapshot, ≤ 1 s old). */
    let siteSupply: SiteSupply | null = null;
    /** Components tab: the selected component (ctlBuiltObjectComponents.SelectedComponent). */
    let selectedComponent: number | null = null;
    const selectedTarget = (): BuiltObject | Habitat | null => (selected ? siteTarget(selected) : null);
    const selectedBO = (): BuiltObject | null => (selected?.kind === 'builtObject' ? selected.builtObject : null);

    // ---- ctlBuiltObjectList (10, 10) 680 × 288 ----
    const ROW_H = 26;
    const siteGrid = new OwGrid<ConstructionSiteRow>({
        key: (r) => siteTarget(r.site),
        rowHeight: ROW_H,
        empty: 'No construction yards',
        columns: [
            { id: 'empire', header: '', width: 25, align: 'center', render: (r, c) => {
                const e = siteTarget(r.site).empire as Empire | null;
                c.appendChild(img(flagUrl(galaxy, e), 'cy-flag', e?.name ?? ''));
            } },
            { id: 'picture', header: '', width: 35, align: 'center', render: (r, c) => {
                c.appendChild(img(sitePictureUrl(r.site), r.site.kind === 'colony' ? 'cy-pic cy-pic-habitat' : 'cy-pic cy-pic-ship'));
            } },
            { id: 'name', header: gt('Name'), width: supplyOn ? 118 : 130, sort: (r) => r.name, render: (r, c) => { c.textContent = r.name; c.title = r.name; } },
            { id: 'role', header: gt('Role'), width: supplyOn ? 100 : 110, sort: (r) => r.type, render: (r, c) => { c.textContent = r.type; c.title = r.type; } },
            { id: 'system', header: gt('System'), width: supplyOn ? 82 : 90, sort: (r) => r.system, render: (r, c) => { c.textContent = r.system; c.title = r.system; } },
            // [improvements] supplyChain: Stalled / Short when the queue lacks resources.
            ...(supplyOn
                ? [{ id: 'supply', header: 'Supply', width: 52, sort: (r: ConstructionSiteRow) => siteSupplyLabel(snapSite(r.site)).text, title: 'Construction short of resources (Waiting For tab)', render: (r: ConstructionSiteRow, c: HTMLDivElement) => {
                      const l = siteSupplyLabel(snapSite(r.site));
                      c.textContent = l.text;
                      c.title = l.title;
                      if (l.cls) c.classList.add(l.cls);
                  } }]
                : []),
            { id: 'yards', header: 'Yards', width: 45, align: 'right', sort: (r) => r.yards, title: 'Construction yards (slipways)', render: (r, c) => { c.textContent = String(r.yards); } },
            { id: 'building', header: 'Building', width: 60, align: 'right', sort: (r) => r.building, title: 'Ships under construction', render: (r, c) => { c.textContent = String(r.building); } },
            { id: 'waiting', header: 'Waiting', width: 55, align: 'right', sort: (r) => r.waiting, title: 'Ships waiting to be constructed', render: (r, c) => { c.textContent = String(r.waiting); } },
            { id: 'speed', header: gt('Speed'), width: 45, align: 'right', sort: (r) => r.speed, title: 'Construction speed', render: (r, c) => { c.textContent = String(r.speed); } },
            { id: 'progress', header: gt('Progress'), align: 'right', sort: (r) => r.progress, title: 'Mean progress of the ships under construction', render: (r, c) => progressCell(c, r.progress, supplyOn ? 52 : 70, r.building > 0, ROW_H) },
        ],
        onSelect: (r) => {
            if (selected && siteTarget(selected) === siteTarget(r.site)) return;
            selected = r.site;
            selectedYard = null;
            selectedWait = null;
            selectedComponent = null;
            setFleet.reset(); // ctlBuiltObjectList_SelectionChanged_1
            refresh();
        },
        onDoubleClick: (r) => goTo(r.site),
    });
    body.appendChild(place(siteGrid.el, L.list.x, L.list.y, L.list.w, L.list.h));

    // ---- gmapBuiltObject (700, 25) 300 × 300 with its title at (700, 7) ----
    dropText(body, gt('Location of selected item in Galaxy'), L.mapTitle.x, L.mapTitle.y, { color: COLORS.label });
    const map = el('canvas', 'cy-map');
    body.appendChild(place(map, L.map.x, L.map.y, L.map.w, L.map.h));

    // ---- Buttons under the list ----
    const btn = (label: string, x: number, y: number, w: number, h: number, onClick: () => void, title = ''): HTMLButtonElement => {
        const b = glassButton(label, { onClick, title });
        body.appendChild(place(b, x, y, w, h));
        return b;
    };
    const B = L.buttons;
    const btnSelect = btn(gt('Select Ship'), B.x, B.y, B.w, B.h, () => {
        const t = selectedTarget();
        if (t) (opts.onSelectOnly ?? opts.onSelect)(t);
    });
    btn(gt('Go to Ship'), B.x + B.step, B.y, B.w, B.h, () => {
        if (selected) goTo(selected);
    });
    const btnViewDesign = btn(gt('View Design'), B.x + 2 * B.step, B.y, B.w, B.h, () => {
        const bo = selectedBO();
        if (bo) openConstructionSummary(galaxy, bo.design);
    });
    const btnViewFleet = btn(gt('View Fleet'), B.x + 3 * B.step, B.y, B.w, B.h, () => {
        const sg = selectedBO()?.shipGroup as ShipGroup | null | undefined;
        if (sg && opts.onViewFleet) opts.onViewFleet(sg);
    });
    // cmbBuiltObjectSetFleet (550, 308) 140 × 18 (method_178; items method_182): the selected ship / base.
    const setFleet = createSetFleetCombo(galaxy, empire, () => {
        const bo = selectedBO();
        return bo !== null ? [bo] : [];
    }, () => refresh());
    body.appendChild(place(setFleet.el, 550, 308, 140, 21));
    const B2 = L.buttons2;
    const shipOp = (op: YardShipOrder) => () => {
        const bo = selectedBO();
        if (!bo) return;
        issuePlayerCommand(galaxy, empire, op, [[bo]], (n) => showToast(yardShipOrderText(op, bo, n)));
    };
    const btnRefuel = btn(gt('Refuel'), B2.x, B2.y, B2.w, B2.h, shipOp('refuelShips'));
    const btnRepair = btn(gt('Repair'), B2.x + B2.step, B2.y, B2.w, B2.h, shipOp('repairShips'));
    const btnRetrofit = btn(gt('Retrofit'), B2.x + 2 * B2.step, B2.y, B2.w, B2.h, () => {
        const bo = selectedBO();
        if (bo) issuePlayerCommand(galaxy, empire, 'retrofitShips', [[bo]], (res) => showToast(retrofitToastText(res)));
    }, 'Retrofit to the latest design of its type');
    const retire = shipOp('retireShips');
    const btnRetire = btn(gt('Retire'), B2.x + 3 * B2.step, B2.y, B2.w, B2.h, () => {
        const bo = selectedBO();
        if (!bo) return;
        void messageBox({ caption: gt('Retire'), text: `${gt('Retire')} ${bo.name}?`, buttons: ['Yes', 'No'], icon: 'question' }).then((b) => {
            if (b === 'Yes') retire();
        });
    });
    // btnBuiltObjectScrapSelected (550, 350) 140 × 25: Main.Part3.cs 403 btnBuiltObjectScrapSelected_Click.
    const btnScrap = btn(gt('Scrap'), B2.x + 4 * B2.step, B2.y, 140, B2.h, () => void scrapSelected());

    // ---- Name (700, 357) / (750, 355) 250 × 20 ----
    dropText(body, gt('Name'), L.nameLabel.x, L.nameLabel.y, { color: COLORS.label, bold: true });
    const nameBox = textBox('', '', () => undefined);
    body.appendChild(place(nameBox, L.name.x, L.name.y, L.name.w, L.name.h));
    const commitName = (): void => {
        const bo = selectedBO();
        if (bo && nameBox.value.trim() !== '' && nameBox.value.trim() !== bo.name) {
            issuePlayerCommand(galaxy, empire, 'renameShip', [bo, nameBox.value], () => refresh());
        }
    };
    nameBox.addEventListener('change', commitName);
    nameBox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') nameBox.blur();
    });

    // ---- pnlBuiltObjectDetail (700, 385) 300 × 300, CornerCurveMode.BottomRight_TopLeft ----
    const detail = gradientPanel({ corners: { tl: true, br: true }, className: 'cy-detail' });
    body.appendChild(place(detail, L.detail.x, L.detail.y, L.detail.w, L.detail.h));

    // ---- tabBuiltObjectData (10, 385) 680 × 300 ----
    const tabs = tabStrip(
        // method_178's tab pages in their Controls order (Cargo, Components, Construction Yards, Docking Bays, Troops,
        // Weapons), then ours.
        TAB_ORDER.map((id) => ({ id, label: id })),
        tab,
        (id) => {
            tab = id as typeof tab;
            showTab();
        },
    );
    body.appendChild(place(tabs, L.tabs.x, L.tabs.y, L.tabs.w));
    const tabButtons = Array.from(tabs.querySelectorAll<HTMLButtonElement>('.ow-tab'));
    const pageFrame = el('div', 'cy-page-frame');
    body.appendChild(place(pageFrame, L.tabs.x, L.tabs.y + 26, L.tabs.w, L.tabs.h - 26));
    const pageYards = place(el('div', 'cy-page'), L.page.x, L.page.y, L.page.w, L.page.h);
    const pageFleets = place(el('div', 'cy-page'), L.page.x, L.page.y, L.page.w, L.page.h);
    const pageJobs = place(el('div', 'cy-page'), L.page.x, L.page.y, L.page.w, L.page.h);
    const pageSupply = place(el('div', 'cy-page'), L.page.x, L.page.y, L.page.w, L.page.h); // [improvements] supplyChain
    // The shared Cargo / Components / Docking Bays / Troops / Weapons pages (builtObjectDataTabs.ts).
    const pageData = place(el('div', 'cy-page'), L.page.x, L.page.y, L.page.w, L.page.h);
    body.append(pageYards, pageFleets, pageJobs, pageSupply, pageData);
    let dataKey = '';
    function showTab(): void {
        pageYards.hidden = tab !== 'yards';
        pageFleets.hidden = tab !== 'fleets';
        pageJobs.hidden = tab !== 'jobs';
        pageSupply.hidden = tab !== 'supply';
        pageData.hidden = !isDataTab(tab);
        dataKey = '';
        refresh();
    }
    function refreshDataPage(): void {
        if (!isDataTab(tab)) return;
        const o = selected ? siteTarget(selected) : null;
        const key = `${tab}|${o ? objectId(o) : ''}|${dataTabContentKey(tab, o, selectedComponent)}`;
        if (key === dataKey) return;
        dataKey = key;
        pageData.replaceChildren();
        const t = tab;
        renderDataTab(t, o, {
            galaxy,
            empire,
            page: pageData,
            rebuild: () => {
                dataKey = '';
                refreshDataPage();
            },
            selectedComponent,
            setSelectedComponent: (i) => {
                selectedComponent = i;
            },
        });
    }

    // Construction Yards tab: ctlConstructionYards (0, 0) 390 × 150.
    const YARD_ROW_H = 26;
    const yardGrid = new OwGrid<YardRow>({
        key: (r) => r.yard,
        rowHeight: YARD_ROW_H,
        empty: 'No construction yards',
        columns: [
            { id: 'component', header: '', width: 30, align: 'center', render: (r, c) => {
                c.appendChild(img(r.componentPicture >= 0 ? componentImageUrl(r.componentPicture) : null, 'cy-comp', r.name));
            } },
            { id: 'empire', header: '', width: 30, align: 'center', render: (r, c) => {
                const e = r.shipObject?.empire ?? null;
                if (r.shipObject) c.appendChild(img(flagUrl(galaxy, e), 'cy-flag', e?.name ?? ''));
            } },
            { id: 'picture', header: '', width: 40, align: 'center', render: (r, c) => {
                if (r.shipObject) c.appendChild(img(shipPictureUrl(r.shipObject), 'cy-pic cy-pic-ship cy-rot'));
            } },
            { id: 'ship', header: gt('Ship'), sort: (r) => r.ship, render: (r, c) => {
                c.textContent = r.ship;
                const order = r.shipObject ? fleetOrders.get(r.shipObject) : undefined;
                c.title = order ? `${r.ship} (fleet build: ${order})` : r.ship;
                if (order) c.classList.add('cy-fleet-build');
                if (r.shipObject) markWaiting(c, r.shipObject);
            } },
            { id: 'progress', header: gt('Progress'), width: 70, align: 'right', sort: (r) => r.progress, render: (r, c) => progressCell(c, r.progress, 70, r.shipObject !== null, YARD_ROW_H) },
            { id: 'speed', header: gt('Speed'), width: 53, align: 'right', sort: (r) => r.speed, render: (r, c) => { c.textContent = String(r.speed); } },
        ],
        onSelect: (r) => {
            selectedYard = r.yard;
            updateButtons();
        },
    });
    pageYards.appendChild(place(yardGrid.el, 0, 0, 390, 150));
    pageYards.appendChild(place(text(gt('Ships waiting to be constructed'), { bold: true, color: COLORS.label }), 0, 158));
    const waitGrid = new OwGrid<WaitRow>({
        key: (r) => r.builtObject,
        rowHeight: 24,
        empty: 'No ships waiting',
        columns: [
            { id: 'empire', header: '', width: 30, align: 'center', render: (r, c) => {
                c.appendChild(img(flagUrl(galaxy, r.builtObject.empire), 'cy-flag', r.builtObject.empire?.name ?? ''));
            } },
            { id: 'picture', header: '', width: 40, align: 'center', render: (r, c) => {
                c.appendChild(img(shipPictureUrl(r.builtObject), 'cy-pic cy-pic-ship cy-rot'));
            } },
            { id: 'name', header: gt('Name'), render: (r, c) => {
                c.textContent = r.name;
                const order = fleetOrders.get(r.builtObject);
                c.title = order ? `${r.name} (fleet build: ${order})` : r.name;
                if (order) c.classList.add('cy-fleet-build');
                markWaiting(c, r.builtObject);
            } },
            { id: 'role', header: gt('Role'), width: 140, render: (r, c) => { c.textContent = r.type; c.title = `${r.type}, ${gt('X credits', Math.trunc(r.price).toFixed(0))}`; } },
        ],
        onSelect: (r) => {
            selectedWait = r.builtObject;
            updateButtons();
        },
    });
    pageYards.appendChild(place(waitGrid.el, 0, 180, 390, 90));

    // pnlBuiltObjectConstructionYardPurchaser (395, 3) 270 × 90 (method_169).
    const purchaser = yardPurchaser(empire, 270, 90, () => refresh());
    pageYards.appendChild(place(purchaser.el, 395, 3, 270, 90));

    const yb = (label: string, x: number, y: number, w: number, h: number, onClick: () => void, title = ''): HTMLButtonElement => {
        const b = glassButton(label, { onClick, title });
        pageYards.appendChild(place(b, x, y, w, h));
        return b;
    };
    const btnScrapShip = yb(gt('Scrap Ship'), 395, 99, 230, 25, () => void scrapShip(), 'Scrap the selected ship under construction (no refund)');
    const btnSummary = yb(gt('Show Construction Summary'), 395, 126, 230, 25, () => {
        const s = selectedYard?.shipUnderConstruction ?? null;
        if (s) openConstructionSummary(galaxy, s.retrofitDesign ?? s.design);
    });
    const move = (m: WaitQueueMove) => () => {
        const t = selectedTarget();
        if (t && selectedWait) issuePlayerCommand(galaxy, empire, 'moveWaitQueueItem', [t, selectedWait, m], () => refresh());
    };
    const btnTop = yb(gt('Move to Top'), 395, 180, 120, 22, move('top'));
    const btnUp = yb(gt('Move Up'), 395, 203, 120, 22, move('up'));
    const btnDown = yb(gt('Move Down'), 395, 226, 120, 22, move('down'));
    const btnRemove = yb(gt('Remove Ship'), 395, 249, 120, 22, () => void removeShip(), 'Remove the selected ship from the queue (half the cost is refunded)');
    const maxSize = text('', { size: FONT.tiny, color: COLORS.label, wrapWidth: 160 });
    pageYards.appendChild(place(maxSize, 515, 180));
    pageYards.appendChild(place(linkLabel(`${gt('Learn about Construction')}...`, () => openGalactopedia({ topic: gt('Construction') }), FONT.small), 515, 250));
    // lblConstructionYardManufacturers (0, 345) + duExoPvEoA (0, 360) 555 × 150, lblConstructionYardManufacturerWaitQueue
    // (0, 520) + ctlConstructionYardManufacturerWaitQueue (0, 535) 555 × 150 (method_169): below the page's 270 px.
    pageYards.classList.add('dt-page-scroll');
    const manufacturing = manufacturingGrids(pageYards, galaxy, empire);

    // Fleet Builds tab (ours): the running fleet-design build orders; the ships of each waiting at the selected yard.
    interface FleetRow {
        id: number;
        name: string;
        built: number;
        total: number;
        building: number;
        here: number;
    }
    const fleetGrid = new OwGrid<FleetRow>({
        key: (r) => r.id,
        rowHeight: 22,
        empty: 'No fleet builds. Build fleets from fleet designs in the Designs screen (Fleet Designs tab).',
        columns: [
            { id: 'name', header: 'Fleet', render: (r, c) => { c.textContent = r.name; c.title = r.name; } },
            { id: 'built', header: 'Built', width: 70, align: 'right', render: (r, c) => { c.textContent = `${r.built} / ${r.total}`; } },
            { id: 'building', header: 'In queues', width: 80, align: 'right', render: (r, c) => { c.textContent = String(r.building); } },
            { id: 'here', header: 'At this yard', width: 95, align: 'right', render: (r, c) => { c.textContent = String(r.here); } },
            { id: 'progress', header: gt('Progress'), width: 110, align: 'right', render: (r, c) => progressCell(c, r.total > 0 ? r.built / r.total : 0, 110, r.total > 0, 22) },
        ],
        onSelect: () => updateButtons(),
    });
    pageFleets.appendChild(place(fleetGrid.el, 0, 0, 540, 270));
    const btnCancelFleet = glassButton('Cancel Build', {
        title: 'Stop the build order: waiting ships are removed and refunded, ships on a slipway finish unassigned (a fleet\'s replacements: also turns off its auto-refill)',
        onClick: () => {
            const r = fleetGrid.selected;
            if (!r) return;
            void messageBox({ caption: 'Cancel Fleet Build', text: `Cancel the build order for ${r.name}?`, buttons: ['Yes', 'No'], icon: 'question' }).then((b) => {
                if (b === 'Yes') issuePlayerCommand(galaxy, empire, 'fleetTemplateCancelOrder', [r.id], (res) => {
                    if (res.ok) showToast(`${r.name}: build cancelled${res.removed > 0 ? `, ${res.removed} ships removed (${Math.round(res.refund).toLocaleString('en-US')} credits refunded)` : ''}`);
                    refresh();
                });
            });
        },
    });
    pageFleets.appendChild(place(btnCancelFleet, 548, 0, 120, 25));

    // Construction Jobs tab (ours): the job board — construction ships are the mobile yards that build bases.
    const jobGrid = new OwGrid<ConstructionJobRow>({
        key: (r) => r.id,
        rowHeight: 22,
        empty: 'No construction jobs. Build orders for stations and bases are queued here and taken by the construction ship that can finish them first.',
        columns: [
            { id: 'job', header: 'Job', render: (r, c) => { c.textContent = r.label; c.title = r.label; } },
            { id: 'state', header: 'State', width: 70, render: (r, c) => { c.textContent = r.state === 'active' ? 'Building' : r.state === 'next' ? 'Next' : 'Open'; } },
            { id: 'ship', header: gt('Ship'), width: 150, render: (r, c) => { c.textContent = r.shipName || '—'; c.title = r.shipName; } },
            { id: 'eta', header: 'ETA', width: 75, align: 'right', render: (r, c) => { c.textContent = r.etaMs === null ? '—' : formatEta(r.etaMs); } },
        ],
        onSelect: () => updateButtons(),
        onDoubleClick: (r) => {
            if (r.ship) goToTarget(r.ship);
        },
    });
    pageJobs.appendChild(place(jobGrid.el, 0, 0, 540, 270));
    const jobBtn = (label: string, y: number, title: string, onClick: () => void): HTMLButtonElement => {
        const b = glassButton(label, { onClick, title });
        pageJobs.appendChild(place(b, 548, y, 120, 22));
        return b;
    };
    const btnJobUp = jobBtn(gt('Move Up'), 0, 'Earlier jobs are handed out first', () => {
        const r = jobGrid.selected;
        if (r) issuePlayerCommand(galaxy, empire, 'constructionJobMoveUp', [r.id], () => refresh());
    });
    const btnJobCancel = jobBtn('Cancel Job', 23, 'Cancel this construction job', () => {
        const r = jobGrid.selected;
        if (r) issuePlayerCommand(galaxy, empire, 'constructionJobCancel', [r.id], () => refresh());
    });
    const btnJobGoto = jobBtn('Go to Ship', 46, 'Select the construction ship and move the view to it', () => {
        const r = jobGrid.selected;
        if (r?.ship) goToTarget(r.ship);
    });

    // [improvements] supplyChain begin — Waiting For tab: what each queued ship lacks and what is bringing it.
    function snapSite(site: ConstructionSite): SiteSupply | null {
        if (!supplyChainEnabled()) return null;
        return supplySnapshot(galaxy, empire)?.bySite.get(siteTarget(site)) ?? null;
    }
    /** A ship row's name cell: its waiting text in the tooltip, amber / red when short / stalled. */
    function markWaiting(c: HTMLDivElement, ship: BuiltObject): void {
        const item = siteSupply?.items.find((i) => i.ship === ship);
        if (!item || item.needs.length === 0) return;
        c.title = `${c.title}\n${itemStateText(item)} — waiting for: ${itemNeedsText(galaxy, item, 6)}`;
        c.classList.add(item.stalled || item.needs.some((n) => n.uncovered > 0) ? 'cy-stalled' : 'cy-short');
    }
    const supplyGrid = new OwGrid<WaitingRow>({
        key: (r) => r.key,
        rowHeight: 22,
        fontSize: FONT.small,
        empty: 'Nothing is queued here.',
        rowClass: (r) => `cy-need-${r.status}${r.first ? ' cy-need-first' : ''}`,
        columns: [
            { id: 'ship', header: gt('Ship'), width: 150, render: (r, c) => {
                c.textContent = r.first ? r.shipText : '';
                c.title = r.title;
            } },
            { id: 'state', header: 'State', width: 70, render: (r, c) => {
                c.textContent = r.first ? r.state : '';
                c.title = r.title;
            } },
            { id: 'resource', header: 'Resource', width: 110, render: (r, c) => {
                c.textContent = r.resource;
                c.title = r.resourceId !== null && resourceSupplyAvailable() ? `${r.resource}: where it is produced, held and needed (click)` : r.title;
                if (r.resourceId !== null && resourceSupplyAvailable()) c.classList.add('cy-link');
            }, onClick: (r) => {
                if (r.resourceId !== null) openResourceSupply(r.resourceId);
            } },
            { id: 'missing', header: 'Missing', width: 58, align: 'right', render: (r, c) => { c.textContent = r.missing; c.title = r.title; } },
            { id: 'coming', header: 'Coming', width: 58, align: 'right', render: (r, c) => { c.textContent = r.coming; c.title = r.title; } },
            { id: 'from', header: 'From', render: (r, c) => { c.textContent = r.from; c.title = r.title; } },
            { id: 'eta', header: 'ETA', width: 64, align: 'right', render: (r, c) => { c.textContent = r.eta; c.title = r.title; } },
        ],
        // Double click: the freighter bringing it (selected, the window stays), else the ship.
        onDoubleClick: (r) => {
            const f = r.delivery?.freighter ?? null;
            const t = f !== null && !f.hasBeenDestroyed ? f : r.ship;
            (opts.onSelectOnly ?? opts.onSelect)(t);
        },
    });
    pageSupply.appendChild(place(supplyGrid.el, 0, 0, 674, 222));
    const supplyNote = text('', { size: FONT.small, color: COLORS.label, wrapWidth: 668 });
    pageSupply.appendChild(place(supplyNote, 3, 226));
    function refreshSupplyPage(): void {
        if (tab !== 'supply') return;
        const rows = waitingRows(galaxy, siteSupply);
        sync(supplyGrid, rows, (r) => `${r.key}|${r.shipText}|${r.state}|${r.missing}|${r.coming}|${r.from}|${r.eta}|${r.status}|${r.title}`, supplyGrid.selected?.key ?? null);
        const s0 = siteSupply;
        let note = '';
        if (selected === null) note = '';
        else if (s0 === null) note = 'Nothing is queued here.';
        else if (s0.resources.length === 0) note = 'Every queued ship has its resources in stock (or its components ready). Double-click a row to select the ship.';
        else {
            const none = s0.resources.filter((r) => r.uncovered > 0);
            note = `${siteHeadline(s0)}. `;
            if (none.length > 0) note += `Nothing coming: ${none.slice(0, 3).map((r) => siteResourceText(galaxy, r, galaxy.playerEmpire).replace(/^[^:]*: /, `${resourceName(galaxy, r.resourceId)}: `)).join('; ')}${none.length > 3 ? ` (+${none.length - 3})` : ''}. `;
            note += 'Double-click a row to select the freighter bringing it; click a resource to see its supply.';
        }
        setText(supplyNote, note);
        supplyNote.classList.toggle('cy-note-alert', s0 !== null && (s0.stalled || s0.nothingComing));
    }
    // [improvements] supplyChain end

    // ---- Actions ----
    function goToTarget(t: BuiltObject | Habitat): void {
        win.close();
        opts.onSelect(t);
    }
    function goTo(site: ConstructionSite): void {
        goToTarget(siteTarget(site));
    }

    /** Main.Part3.cs 403 btnBuiltObjectScrapSelected_Click: confirm, scrap the selected ship / base ('scrapShips'), then
     *  select the row before it (or the next one, when it is the first) as method_178(builtObject_, filter) does. */
    async function scrapSelected(): Promise<void> {
        const bo = selectedBO();
        if (bo === null) return;
        const answer = await messageBox({
            caption: gt('Scrap selected ships and bases?'),
            text: gt('Scrapping ships and bases permanently and immediately removes them from the game'),
            buttons: ['Yes', 'No'],
            defaultButton: 'No',
            icon: 'warning',
        });
        if (answer !== 'Yes' || win.closed) return;
        const shown = siteGrid.displayed;
        const i = shown.findIndex((r) => siteTarget(r.site) === bo);
        const next = i > 0 ? shown[i - 1] : i === 0 && shown.length > 1 ? shown[1] : null;
        issuePlayerCommand(galaxy, empire, 'scrapShips', [[bo]], () => {
            selected = next?.site ?? null;
            selectedYard = null;
            selectedWait = null;
            selectedComponent = null;
            refresh();
        });
    }

    async function removeShip(): Promise<void> {
        const site = selected;
        const ship = selectedWait;
        if (!site || !ship) return;
        if (ship.owner === null) {
            await messageBox({
                caption: gt('Cannot remove ship from queue'),
                text: ship.empire !== null ? gt('This ship is privately owned - it cannot be removed') : gt('This ship is not owned by your empire - it cannot be removed'),
                icon: 'information',
            });
            return;
        }
        const t = `${gt('Removing this ship from the construction queue will refund half the purchase cost', (ship.purchasePrice * 0.5).toFixed(0))} (${ship.name})`;
        if ((await messageBox({ caption: gt('Remove Ship from Construction Queue?'), text: t, buttons: ['Yes', 'No'], icon: 'question' })) !== 'Yes') return;
        issuePlayerCommand(galaxy, empire, 'yardRemoveFromQueue', [siteTarget(site), ship], () => {
            selectedWait = null;
            refresh();
        });
    }

    async function scrapShip(): Promise<void> {
        const site = selected;
        const ship = selectedYard?.shipUnderConstruction ?? null;
        if (!site || !ship) return;
        if (ship.owner === null) {
            await messageBox({
                caption: gt('Cannot scrap ship'),
                text: ship.empire !== null ? gt('This ship is privately owned - it cannot be scrapped') : gt('This ship is not owned by your empire - it cannot be scrapped'),
                icon: 'information',
            });
            return;
        }
        const t = `${gt('The purchase cost will not be refunded if you scrap this ship')} (${ship.name})`;
        if ((await messageBox({ caption: gt('Scrap Ship under Construction?'), text: t, buttons: ['Yes', 'No'], icon: 'warning' })) !== 'Yes') return;
        issuePlayerCommand(galaxy, empire, 'yardScrapShip', [siteTarget(site), ship], () => refresh());
    }

    // ---- Refresh ----
    let fleetOrders = new Map<BuiltObject, string>();
    let detailKey = '';

    /** Re-render a grid only when its rows (or the selection / the loaded flags) changed, so clicks are not lost to
     *  a rebuild between mouse down and up. */
    const gridKeys = new WeakMap<object, string>();
    function sync<T>(grid: OwGrid<T>, data: T[], sig: (r: T) => string, sel: unknown): void {
        const key = `${data.map(sig).join('\n')}#${sel !== null && typeof sel === 'object' ? objectId(sel) : String(sel)}#${flagsVersion}`;
        if (gridKeys.get(grid) === key) return;
        gridKeys.set(grid, key);
        grid.setRows(data);
        if (sel !== null) grid.select(sel, false);
    }

    function updateButtons(): void {
        const bo = selectedBO();
        const mobile = bo !== null && bo.topSpeed > 0 && bo.role !== BuiltObjectRole.Base;
        btnSelect.disabled = selected === null;
        btnViewDesign.disabled = bo === null;
        btnScrap.disabled = bo === null;
        btnViewFleet.disabled = !(bo !== null && bo.shipGroup != null && opts.onViewFleet);
        // ctlBuiltObjectList_SelectionChanged: Enabled for a Military ship.
        setFleet.update(bo !== null && bo.role === BuiltObjectRole.Military);
        btnRefuel.disabled = !mobile;
        btnRepair.disabled = !(mobile && bo!.damagedComponentCount > 0);
        btnRetrofit.disabled = bo === null || bo.owner === null;
        btnRetire.disabled = !(mobile && bo!.owner !== null);
        nameBox.disabled = bo === null;
        const ship = selectedYard?.shipUnderConstruction ?? null;
        btnScrapShip.disabled = ship === null;
        btnSummary.disabled = ship === null;
        const hasWait = selectedWait !== null;
        btnTop.disabled = btnUp.disabled = btnDown.disabled = btnRemove.disabled = !hasWait;
        btnCancelFleet.disabled = fleetGrid.selected === null;
        const job = jobGrid.selected;
        btnJobUp.disabled = btnJobCancel.disabled = job === null;
        btnJobGoto.disabled = job?.ship == null;
    }

    function refreshPurchaser(): void {
        // method_169 (bool_28 true): not bound for a site the player does not own; disabled at a mobile yard (TopSpeed > 0).
        purchaser.bind(selected, true, true);
    }

    function refreshDetail(r: ConstructionSiteRow | null): void {
        const ss = siteSupply;
        const supplyKey = ss === null ? '' : `${ss.stalled}|${ss.nothingComing}|${ss.resources.map((x) => `${x.resourceId}:${x.missing}`).join(',')}`;
        const key = r ? `${r.name}|${r.type}|${r.system}|${r.yards}|${r.building}|${r.waiting}|${r.speed}|${Math.round(r.progress * 1000)}|${supplyKey}` : '';
        if (key === detailKey) return;
        detailKey = key;
        detail.replaceChildren();
        if (!r) return;
        detail.appendChild(place(img(sitePictureUrl(r.site), r.site.kind === 'colony' ? 'cy-detail-pic' : 'cy-detail-pic cy-rot'), 10, 10, 90, 90));
        const name = text(r.name, { size: FONT.header, bold: true, color: 'rgb(255, 255, 255)' });
        name.classList.add('cy-ellipsis');
        detail.appendChild(place(name, 108, 14, 180));
        dropText(detail, r.type, 108, 40, { color: COLORS.label });
        dropText(detail, r.system, 108, 60, { color: COLORS.label });
        const lines: [string, string][] = [
            ['Construction Yards', String(r.yards)],
            ['Under construction', String(r.building)],
            ['Waiting', String(r.waiting)],
            [gt('Construction Speed'), String(r.speed)],
            [gt('Progress'), r.building > 0 ? formatProgressP(r.progress) : '-'],
        ];
        lines.forEach(([l, v], i) => valueRow(detail, l, v, 160, 118 + i * 22));
        if (r.site.kind === 'builtObject' && r.site.builtObject.topSpeed > 0) {
            detail.appendChild(place(text('A mobile yard: ships cannot be purchased here.', { size: FONT.tiny, color: COLORS.label, wrapWidth: 270 }), 12, 238));
        }
        // [improvements] supplyChain: the site's supply headline (Waiting For tab for the details).
        if (ss !== null && ss.resources.length > 0) {
            const t = text(`${ss.stalled ? 'Stalled' : 'Short'}: ${ss.resources.slice(0, 3).map((x) => `${resourceName(galaxy, x.resourceId)} ${formatUnits(x.missing)}`).join(', ')}${ss.resources.length > 3 ? '…' : ''}${ss.nothingComing ? ' — nothing coming' : ''}`, { size: FONT.tiny, wrapWidth: 276 });
            t.classList.add(ss.stalled || ss.nothingComing ? 'cy-stalled' : 'cy-short', 'cy-link');
            t.title = 'Open the Waiting For tab';
            t.addEventListener('click', () => tabButtons[TAB_ORDER.indexOf('supply')].click());
            detail.appendChild(place(t, 12, 258));
        }
    }

    function drawMap(): void {
        const W = L.map.w;
        const dpr = Math.min(3, window.devicePixelRatio || 1) * Math.max(1, win.scale);
        const px = Math.round(W * dpr);
        if (map.width !== px) {
            map.width = px;
            map.height = px;
        }
        const ctx = map.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, W);
        const s = galaxyMapScale(galaxy, W);
        // GalaxyMap.cs method_6: backdrop (bitmap_1), nebulae (bitmap_0) and territory (bitmap_2) under the dots.
        drawGalaxyMapLayers(ctx, galaxy, s, 0, 0, { onChange: () => { if (map.isConnected) drawMap(); } });
        drawMapTerritory(ctx, galaxy, W);
        const sizes = starDotSizes(W, true);
        const dot = (x: number, y: number, color: string, size: number): void => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.ellipse(x / s, y / s, size / 2, size / 2, 0, 0, Math.PI * 2);
            ctx.fill();
        };
        for (const sys of galaxy.systems) dot(sys.systemStar.xpos, sys.systemStar.ypos, DIMMED_COLOR, sizes.normal);
        // GalaxyMap.SetLocations: the listed yards, the selected one in yellow with a crosshair.
        for (const r of rows) {
            const t = siteTarget(r.site);
            dot(t.xpos, t.ypos, 'rgb(96, 160, 255)', sizes.selected);
        }
        const t = selectedTarget();
        if (t) {
            const x = t.xpos / s;
            const y = t.ypos / s;
            ctx.strokeStyle = SELECTED_COLOR;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x - 10, y);
            ctx.lineTo(x + 10, y);
            ctx.moveTo(x, y - 10);
            ctx.lineTo(x, y + 10);
            ctx.stroke();
            dot(t.xpos, t.ypos, SELECTED_COLOR, sizes.selected + 2);
        }
    }

    function refresh(): void {
        if (win.closed) return;
        rows = constructionSiteRows(empire);
        let row = selected ? rows.find((r) => siteTarget(r.site) === siteTarget(selected!)) ?? null : null;
        if (!row && rows.length > 0) {
            row = rows[0];
            selectedYard = null;
            selectedWait = null;
        }
        selected = row?.site ?? null;
        siteSupply = selected !== null ? snapSite(selected) : null; // [improvements] supplyChain
        const supplySig = (r: ConstructionSiteRow): string => (supplyOn ? siteSupplyLabel(snapSite(r.site)).text : '');
        sync(siteGrid, rows, (r) => `${r.name}|${r.type}|${r.system}|${r.yards}|${r.building}|${r.waiting}|${r.speed}|${Math.round(r.progress * 10000)}|${supplySig(r)}`, selected ? siteTarget(selected) : null);

        const bo = selectedBO();
        if (document.activeElement !== nameBox) nameBox.value = bo?.name ?? (selected?.kind === 'colony' ? selected.habitat.name : '');

        fleetOrders = fleetOrderByShip(fleetDesignBook(empire).orders);
        const y = selected ? yardRows(selected, component) : [];
        if (selectedYard && !y.some((r) => r.yard === selectedYard)) selectedYard = null;
        const waitSig = (b: BuiltObject | null): string => {
            const it = b !== null ? siteSupply?.items.find((i) => i.ship === b) : undefined;
            return it ? `${it.stalled}|${itemNeedsText(galaxy, it, 6)}` : '';
        };
        sync(yardGrid, y, (r) => `${objectId(r.yard)}|${r.ship}|${r.progressText}|${r.speed}|${r.shipObject ? (fleetOrders.get(r.shipObject) ?? '') : ''}|${waitSig(r.shipObject)}`, selectedYard);
        const w = selected ? waitRows(selected) : [];
        if (selectedWait && !w.some((r) => r.builtObject === selectedWait)) selectedWait = null;
        sync(waitGrid, w, (r) => `${objectId(r.builtObject)}|${r.name}|${r.type}|${fleetOrders.get(r.builtObject) ?? ''}|${waitSig(r.builtObject)}`, selectedWait);

        const under = row ? row.building : 0;
        const labels = builtObjectTabLabels(selected ? siteTarget(selected) : null);
        const caption: Record<string, string> = { cargo: labels.cargo, components: labels.components, yards: `${gt('Construction Yards')}${under > 0 ? ` (${under})` : ''}`, docking: labels.docking, troops: labels.troops, weapons: labels.weapons };
        TAB_ORDER.forEach((id, i) => {
            if (caption[id] !== undefined) setText(tabButtons[i], caption[id]);
        });
        const orders = fleetDesignBook(empire).orders;
        const waitSet = new Set(w.map((r) => r.builtObject));
        for (const r of y) if (r.shipObject) waitSet.add(r.shipObject);
        sync(
            fleetGrid,
            orders.map((o) => {
                const p = fleetBuildProgress(empire, o);
                return { id: o.id, name: o.name, built: p.built, total: p.total, building: p.building, here: o.pending.filter((b) => waitSet.has(b)).length };
            }),
            (r) => `${r.id}|${r.name}|${r.built}|${r.total}|${r.building}|${r.here}`,
            fleetGrid.selected?.id ?? null,
        );
        setText(tabButtons[TAB_ORDER.indexOf('fleets')], `Fleet Builds${orders.length > 0 ? ` (${orders.length})` : ''}`);
        const jobs = constructionJobRows(galaxy, empire);
        sync(jobGrid, jobs, (r) => `${r.id}|${r.label}|${r.state}|${r.shipName}|${r.etaMs === null ? '' : Math.round(r.etaMs / 1000)}`, jobGrid.selected?.id ?? null);
        setText(tabButtons[TAB_ORDER.indexOf('jobs')], `Construction Jobs${jobs.length > 0 ? ` (${jobs.length})` : ''}`);
        // [improvements] supplyChain
        const supplyBtn = tabButtons[TAB_ORDER.indexOf('supply')];
        supplyBtn.hidden = !supplyChainEnabled();
        const shortItems = siteSupply?.items.filter((i) => i.needs.length > 0).length ?? 0;
        setText(supplyBtn, `Waiting For${shortItems > 0 ? ` (${shortItems}${siteSupply!.stalled || siteSupply!.nothingComing ? '!' : ''})` : ''}`);
        supplyBtn.classList.toggle('cy-tab-alert', siteSupply !== null && (siteSupply.stalled || siteSupply.nothingComing));
        refreshSupplyPage();

        setText(maxSize, maximumSizeText(empireMaximumSizes(empire)));
        refreshPurchaser();
        manufacturing.bind(selected ? siteTarget(selected) : null);
        refreshDataPage();
        refreshDetail(row);
        drawMap();
        updateButtons();
    }

    showTab();
    if (selected) siteGrid.select(siteTarget(selected));
    // Progress moves while open: refresh every second, keeping the selections and scroll positions.
    // Worker mode: bring what the screen shows up to date now instead of up to a cold cycle later (no-op in-thread).
    requestSimRefresh(galaxy, [empire, empire.constructionYards ?? [], empire.spacePorts], () => refresh());
    timer = window.setInterval(refresh, 1000);

    return { win, close: () => win.close() };
}
