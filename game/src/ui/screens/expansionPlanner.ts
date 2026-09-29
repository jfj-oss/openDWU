// Expansion Planner (task 16a): a streamlined in-game DOM panel opened by F3
// or the top-bar btnExpansionPlanner button. It ports the original's
// pnlExpansionPlanner target list: the mode select (Main.Part4.cs:2721
// method_538), the per-mode list (Main.Part4.cs:2364 method_532), the grid
// (HabitatPrioritizationListView.cs:375 BindData) and the row click
// (Main.Part4.cs:3027 btnExpansionPlannerGotoTarget_Click: move view, zoom,
// close).
//
// TODO(port): "Your Empire Resource Locations" mode — Empire.ResolveResourceSupplyLocations is not ported (Main.Part4.cs:2382)
// TODO(port): canColonizeBecauseAtWar — galaxy.checkEmpireTerritoryCanColonizeHabitat does not return the C# out parameter (Galaxy.cs 3613), so the "Colonization target in another empire's system" status never shows
// TODO(port): galaxy mini-map, deficient-resources grid (Main.Part11.cs:2393 IdentifyDeficientEmpireResources), available ships + Build Colony Ship (Main.Part4.cs method_533), resource/percent filters (Main.Part4.cs FilterOutHabitatPrioritizationList) — not in 16a

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
    identifyResourceCentres,
} from '../../sim/resourceTargets';
import { prioritizeEmpireResourceNeeds } from '../../sim/industry';
import { canEmpireColonizeHabitatRange, habitatResourcesHaveSuperLuxury } from '../../sim/exploration';
import { checkColonizationLikeliness } from '../../sim/tradeItems';
import { fastFindNearestSpacePort } from '../../sim/stationPlacement';
import { habitatTypeLabel, rgbCss } from '../hud';
import { formatThousandsK } from './coloniesList';

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
            list = [];
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
    name: string;
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
    return {
        habitat,
        name: habitat.name,
        type: habitatTypeDescription(habitat.type, habitat.category),
        size: formatThousandsK(Math.trunc(habitat.diameter) * 100),
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
// DOM
// ---------------------------------------------------------------------------

export interface ExpansionPlannerOptions {
    /** The player's empire. */
    empire: Empire;
    /** Select the habitat and move the Main View to it (GotoTarget). */
    onSelect: (h: Habitat) => void;
}

interface OpenState {
    root: HTMLElement;
    close: () => void;
}

let open: OpenState | null = null;
/** Last selected mode, kept across reopen (BaconMain.method_532_SetExpansionPlanner). */
let lastMode: ExpansionMode = 'colonies';

/** Open the Expansion Planner, or close it if it is already open. */
export function toggleExpansionPlanner(opts: ExpansionPlannerOptions): void {
    if (open) {
        open.close();
    } else {
        open = createExpansionPlanner(opts);
    }
}

/** Close the Expansion Planner (no-op when closed). */
export function closeExpansionPlanner(): void {
    open?.close();
}

const HEADERS: readonly [string, boolean][] = [
    ['Name', false],
    ['Type', false],
    ['Size', true],
    ['Quality', true],
    ['Distance', true],
    ['Race', false],
    ['Pop', true],
    ['Resources', false],
    ['', false], // Ruins
    ['', false], // Assigned ship
    ['', false], // Rarity
];

function createExpansionPlanner(opts: ExpansionPlannerOptions): OpenState {
    const galaxy = opts.empire.galaxy;
    const player = opts.empire;
    let includeLowQuality = false;
    let includeAsteroids = false;

    const root = document.createElement('div');
    root.className = 'expansion-planner-wrap';

    const win = document.createElement('div');
    win.className = 'expansion-planner-window';

    const titlebar = document.createElement('div');
    titlebar.className = 'expansion-planner-titlebar';
    const heading = document.createElement('div');
    heading.className = 'expansion-planner-heading';
    titlebar.appendChild(heading);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'expansion-planner-close';
    closeBtn.title = 'Close';
    closeBtn.textContent = '✕';
    titlebar.appendChild(closeBtn);
    win.appendChild(titlebar);

    const toolbar = document.createElement('div');
    toolbar.className = 'expansion-planner-toolbar';
    const select = document.createElement('select');
    select.className = 'expansion-planner-mode';
    for (const mode of EXPANSION_MODES) {
        const opt = document.createElement('option');
        opt.value = mode;
        opt.textContent = expansionModeLabel(mode);
        if (mode === 'resourcessupply') {
            opt.disabled = true;
            opt.title = 'not yet available';
        }
        select.appendChild(opt);
    }
    select.value = lastMode;
    const checkLabel = document.createElement('label');
    checkLabel.className = 'expansion-planner-check';
    const check = document.createElement('input');
    check.type = 'checkbox';
    const checkText = document.createElement('span');
    checkLabel.append(check, checkText);
    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'expansion-planner-refresh';
    refreshBtn.textContent = 'Refresh';
    toolbar.append(select, checkLabel, refreshBtn);
    win.appendChild(toolbar);

    const body = document.createElement('div');
    body.className = 'expansion-planner-body';
    win.appendChild(body);
    root.appendChild(win);
    document.body.appendChild(root);

    function syncCheckbox(): void {
        const colonies = lastMode === 'colonies';
        checkText.textContent = colonies ? 'Show low-quality colonies' : 'Show asteroids';
        check.checked = colonies ? includeLowQuality : includeAsteroids;
    }

    // Recomputed only on open, mode/checkbox change and Refresh (the colonisation search walks every explored system).
    function rebuild(): void {
        const forColonization = lastMode === 'colonies';
        const rows = expansionTargets(lastMode, galaxy, player, { includeLowQuality, includeAsteroids }).map((t) =>
            expansionRow(galaxy, player, t, forColonization),
        );
        heading.textContent = `Expansion Planner (${rows.length})`;
        body.replaceChildren();
        if (rows.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'expansion-planner-empty';
            empty.textContent = 'No targets';
            body.appendChild(empty);
            return;
        }
        const table = document.createElement('table');
        table.className = 'expansion-planner-table';
        const thead = document.createElement('thead');
        const htr = document.createElement('tr');
        for (const [text, num] of HEADERS) {
            const th = document.createElement('th');
            th.textContent = text;
            if (text === 'Distance') th.title = 'Distance from your nearest Space Port';
            if (num) th.className = 'expansion-planner-number';
            htr.appendChild(th);
        }
        thead.appendChild(htr);
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        for (const row of rows) {
            const tr = document.createElement('tr');
            tr.className = 'expansion-planner-row';
            if (row.color !== null) tr.style.color = rgbCss(row.color);
            const cells: [string, string][] = [
                [row.name, ''],
                [row.type, ''],
                [row.size, 'expansion-planner-number'],
                [row.quality, 'expansion-planner-number'],
                [row.distance, 'expansion-planner-number'],
                [row.race, ''],
                [row.population, 'expansion-planner-number'],
                [row.resources, 'expansion-planner-resources'],
                [row.ruins, ''],
                [row.assigned, ''],
                [row.rarity, ''],
            ];
            cells.forEach(([text, cls], i) => {
                const td = document.createElement('td');
                td.textContent = text;
                if (cls) td.className = cls;
                td.title = i === 9 && row.assignedTip ? row.assignedTip : row.reason;
                tr.appendChild(td);
            });
            tr.addEventListener('click', () => {
                close();
                opts.onSelect(row.habitat);
            });
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        body.appendChild(table);
    }

    select.addEventListener('change', () => {
        lastMode = select.value as ExpansionMode;
        syncCheckbox();
        rebuild();
    });
    check.addEventListener('change', () => {
        if (lastMode === 'colonies') includeLowQuality = check.checked;
        else includeAsteroids = check.checked;
        rebuild();
    });
    refreshBtn.addEventListener('click', () => rebuild());

    function close(): void {
        document.removeEventListener('keydown', onKeyDown);
        root.remove();
        open = null;
    }

    // Escape closes the panel; stopImmediatePropagation keeps the global game-menu Escape handler from opening too.
    function onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            close();
        }
    }
    document.addEventListener('keydown', onKeyDown);
    closeBtn.addEventListener('click', () => close());

    syncCheckbox();
    rebuild();
    return { root, close };
}
