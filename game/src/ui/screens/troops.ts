// Troops screen: a streamlined port of the original's Troops panel (Main.Part9.cs:3129 tbtnTroops_Click toggles
// pnlTroopInfo; Main.Part11.cs:3730 method_172 lays it out, 3637 cmbTroopFilter_SelectedIndexChanged fills it,
// 3611 method_171 writes the summary; TroopListView.cs for the columns). The original has no hotkey for it
// (Main_KeyUp has no case; its hover hint "Open Troops screen" carries no key).
//
// Left: the filter (FleetHabitatDropDown.cs: "(None)" = all troops, then the fleets, then the colonies by name).
// Right: the summary, the troop grid (Name / Experience / Type / Readiness / Attack / Defend / Maintenance /
// Location; header click sorts, as DataGridViewColumnSortMode.Automatic), the rename box and the original's four
// buttons (Go to Troop, Disband, Garrison, Ungarrison). When the filter is a colony the player owns, the colony's
// recruit options (the selection panel's five RecruitTroops buttons, Main.Part3.cs:2759-2860) are shown too and go
// through executeShipAction (Main.Part7.cs:883-951).
//
// TODO(port): the mini galaxy map beside the list (dboYnQplv3 SetPosition) — Main.Part11.cs:3808 ctlTroopList_SelectionChanged
// TODO(port): the "Learn about Troops..." Galactopedia link — Main.Part4.cs:2138 lnkTroops_LinkClicked
// TODO(port): AutoPauseWhenInPopupWindow pause/resume — Main.Part11.cs:3733 / 4661 method_184

import './troops.css';
import type { Empire } from '../../sim/empire';
import { empireGovernmentAttributes } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { BuiltObject } from '../../sim/builtObject';
import type { Habitat } from '../../sim/types';
import { Troop, TroopType, type TroopList } from '../../sim/cargo';
import type { Race } from '../../sim/data/races';
import { TROOP_ANNUAL_MAINTENANCE } from '../../sim/forceStructure';
import { resolveInvasionEmpires } from '../../sim/troops';
import { resolveLeaderTroopMaintenanceFactor, resolveTroopLocationMaintenanceDivisor } from '../../sim/characters';
import { type ShipGroup, empireShipGroups } from '../../sim/fleets/shipGroup';
import { compareShipGroups } from '../../sim/fleets/shipGroupTasks';
import { netSort } from '../../sim/netSort';
import { tryGetText } from '../../sim/textResolver';
import { ShipActionType, createShipAction, type ShipAction } from '../../sim/player/shipAction';
import { executeShipAction } from '../../sim/player/executeShipAction';
import { resolveRecruitableTroopsForColony, applyAutomationOff } from '../../sim/player/orderMenu';
import { formatThousandsK } from './coloniesList';

/** GameText lookup with the English text as fallback (tests run without GameText loaded). */
function T(key: string, english: string): string {
    return tryGetText(key) ?? english;
}

const NAME_COLLATOR = new Intl.Collator('en-US');

// ---------------------------------------------------------------------------------------------------------------
// Descriptions (Galaxy.7.cs)
// ---------------------------------------------------------------------------------------------------------------

/** Port of Galaxy.7.cs:5406 ResolveDescription(TroopType); '' for Undefined. */
export function troopTypeDescription(type: TroopType): string {
    switch (type) {
        case TroopType.Infantry: return T('TroopType Infantry', 'Infantry');
        case TroopType.Armored: return T('TroopType Armored', 'Armored');
        case TroopType.Artillery: return T('TroopType Artillery', 'Planetary Defense Unit');
        case TroopType.SpecialForces: return T('TroopType SpecialForces', 'Special Forces');
        case TroopType.PirateRaider: return T('TroopType PirateRaider', 'Pirate Raider');
    }
    return '';
}

/**
 * Port of Galaxy.7.cs:5430 ResolveTroopStrengthDescription (the "Experience" column): the troop's defend (Infantry,
 * Artillery ×0.75) or attack (PirateRaider, Armored ×3, SpecialForces ×2) strength against its race's TroopStrength
 * ×1 / ×1.5 / ×2.5 → Green / Experienced / Veteran / Elite. '' when the troop has no race.
 */
export function troopStrengthDescription(troop: Troop): string {
    const race = troop.race as Race | null;
    if (race === null) return '';
    const num = race.troopStrength * 1.0;
    const num2 = race.troopStrength * 1.5;
    const num3 = race.troopStrength * 2.5;
    let num4 = 0.0;
    let num5 = 1.0;
    switch (troop.type) {
        case TroopType.Infantry: num4 = troop.defendStrength; break;
        case TroopType.Artillery: num4 = troop.defendStrength; num5 = 0.75; break;
        case TroopType.PirateRaider: num4 = troop.attackStrength; break;
        case TroopType.Armored: num4 = troop.attackStrength; num5 = 3.0; break;
        case TroopType.SpecialForces: num4 = troop.attackStrength; num5 = 2.0; break;
    }
    if (num4 <= num * num5) return T('Troop Strength Level Green', 'Green');
    if (num4 <= num2 * num5) return T('Troop Strength Level Experienced', 'Experienced');
    if (!(num4 <= num3 * num5)) return T('Troop Strength Level Elite', 'Elite');
    return T('Troop Strength Level Veteran', 'Veteran');
}

/** Port of TroopList.cs:80 GetTroopCountsByType. */
export function troopCountsByType(troops: readonly Troop[]): { infantry: number; artillery: number; armor: number; specialForces: number } {
    const r = { infantry: 0, artillery: 0, armor: 0, specialForces: 0 };
    for (const t of troops) {
        if (t == null) continue;
        switch (t.type) {
            case TroopType.Infantry: r.infantry++; break;
            case TroopType.Armored: r.armor++; break;
            case TroopType.Artillery: r.artillery++; break;
            case TroopType.SpecialForces: r.specialForces++; break;
        }
    }
    return r;
}

/** Port of Galaxy.7.cs:5467 ResolveTroopCompositionDescription ("3 Inf, 1 PDU, 2 Arm"). */
export function troopCompositionDescription(infantryCount: number, artilleryCount: number, armoredCount: number, specialForcesCount: number): string {
    const parts: string[] = [];
    if (infantryCount > 0) parts.push(`${infantryCount} ${T('TroopType Infantry Abbreviation', 'Inf')}`);
    if (artilleryCount > 0) parts.push(`${artilleryCount} ${T('TroopType Artillery Abbreviation', 'PDU')}`);
    if (armoredCount > 0) parts.push(`${armoredCount} ${T('TroopType Armored Abbreviation', 'Arm')}`);
    if (specialForcesCount > 0) parts.push(`${specialForcesCount} ${T('TroopType SpecialForces Abbreviation', 'SF')}`);
    return parts.join(', ');
}

// ---------------------------------------------------------------------------------------------------------------
// Rows (TroopListView.cs:247 BindData)
// ---------------------------------------------------------------------------------------------------------------

/**
 * TroopListView.cs:288-300 the "Maintenance" cell: TroopAnnualMaintenance × government MaintenanceCosts ×
 * troop MaintenanceMultiplier × empire TroopMaintenanceFactor; 0 while the troop is being recruited.
 */
export function troopRowMaintenance(troop: Troop): number {
    let num1 = 1.0;
    let num2 = 1.0;
    const empire = troop.empire as Empire | null;
    if (empire !== null) {
        num2 = empire.troopMaintenanceFactor;
        const gov = empireGovernmentAttributes(empire);
        if (gov !== null) num1 = gov.maintenanceCosts;
    }
    const num3 = TROOP_ANNUAL_MAINTENANCE * num1 * troop.maintenanceMultiplier * num2;
    return troop.beingRecruited ? 0.0 : num3;
}

/** TroopListView.cs:301-306 the "Location" cell: colony name, "(Onboard SHIP)", or ''. */
export function troopLocation(troop: Troop): string {
    const colony = troop.colony as Habitat | null;
    if (colony !== null) return colony.name;
    const bo = troop.builtObject as BuiltObject | null;
    if (bo !== null) return `(${T('Onboard', 'Onboard')} ${bo.name})`;
    return '';
}

export interface TroopRow {
    troop: Troop;
    empireName: string;
    name: string;
    garrisoned: boolean;
    experience: string;
    type: string;
    /** Readiness 0-100 (cell format "##0"). */
    readiness: number;
    /** OverallAttackStrength (cell format "####0"). */
    attack: number;
    defend: number;
    maintenance: number;
    location: string;
}

/** Port of TroopListView.cs:262-306 (one grid row). */
export function troopRow(troop: Troop): TroopRow {
    const empire = troop.empire as Empire | null;
    return {
        troop,
        empireName: empire !== null ? empire.name : `(${T('None', 'None')})`,
        name: troop.name,
        garrisoned: troop.garrisoned,
        experience: troopStrengthDescription(troop),
        type: troopTypeDescription(troop.type),
        readiness: troop.readiness,
        attack: troop.overallAttackStrength,
        defend: troop.overallDefendStrength,
        maintenance: troopRowMaintenance(troop),
        location: troopLocation(troop),
    };
}

export function troopRows(troops: readonly Troop[]): TroopRow[] {
    return troops.filter((t) => t != null).map(troopRow);
}

/** The sortable columns (TroopListView.cs: every column but the flag is SortMode.Automatic). */
export type TroopSortKey = 'name' | 'experience' | 'type' | 'readiness' | 'attack' | 'defend' | 'maintenance' | 'location';

export const TROOP_COLUMNS: { key: TroopSortKey; label: string; numeric: boolean }[] = [
    { key: 'name', label: 'Name', numeric: false },
    { key: 'experience', label: 'Experience', numeric: false },
    { key: 'type', label: 'Type', numeric: false },
    { key: 'readiness', label: 'Readiness', numeric: true },
    { key: 'attack', label: 'Attack Strength', numeric: true },
    { key: 'defend', label: 'Defend Strength', numeric: true },
    { key: 'maintenance', label: 'Maintenance', numeric: true },
    { key: 'location', label: 'Location', numeric: false },
];

/**
 * DataGridView automatic column sort: string cells by culture-sensitive compare, double cells by value; the bound
 * order (the TroopList order) breaks ties. `key` null keeps the bound order.
 */
export function sortTroopRows(rows: readonly TroopRow[], key: TroopSortKey | null, descending: boolean): TroopRow[] {
    const indexed = rows.map((r, i) => ({ r, i }));
    if (key === null) return rows.slice();
    const numeric = TROOP_COLUMNS.find((c) => c.key === key)!.numeric;
    indexed.sort((a, b) => {
        const va = a.r[key];
        const vb = b.r[key];
        let c = numeric ? (va as number) - (vb as number) : NAME_COLLATOR.compare(va as string, vb as string);
        if (descending) c = -c;
        return c !== 0 ? c : a.i - b.i;
    });
    return indexed.map((x) => x.r);
}

/** Cell text for a numeric column ("##0" / "####0" / "#####0": rounded, no separators). */
export function formatTroopNumber(v: number): string {
    return String(Math.round(v));
}

// ---------------------------------------------------------------------------------------------------------------
// Summary (Main.Part11.cs:3611 method_171) and TroopList.cs:447 AnnualTroopMaintenance
// ---------------------------------------------------------------------------------------------------------------

/** Port of TroopList.cs:447 AnnualTroopMaintenance(empire): skips troops being recruited. */
export function troopListAnnualMaintenance(troops: readonly Troop[], empire: Empire | null): number {
    let num1 = 0.0;
    const num2 = empire !== null ? resolveLeaderTroopMaintenanceFactor(empire) : 1.0;
    for (const troop of troops) {
        if (troop == null || troop.beingRecruited) continue;
        let num3 = TROOP_ANNUAL_MAINTENANCE * troop.maintenanceMultiplier;
        if (empire !== null) {
            num3 *= empire.troopMaintenanceFactor;
            const gov = empireGovernmentAttributes(empire);
            if (gov !== null) num3 *= gov.maintenanceCosts;
        }
        let num4 = num3 / num2;
        const colony = troop.colony as Habitat | null;
        const divisor = resolveTroopLocationMaintenanceDivisor(colony, colony !== null ? null : (troop.builtObject as BuiltObject | null));
        if (divisor !== null) num4 /= divisor;
        num1 += num4;
    }
    return num1;
}

/** TroopList.cs:285 / 296 TotalAttackStrength / TotalDefendStrength: (int) of the readiness-weighted sums. */
function totalStrength(troops: readonly Troop[], attack: boolean): number {
    let total = 0.0;
    for (const t of troops) if (t != null) total += (attack ? t.attackStrength : t.defendStrength) * t.readiness;
    return Math.trunc(total);
}

/** Port of Main.Part11.cs:3611 method_171: the four summary lines. */
export function troopSummaryLines(troops: readonly Troop[], player: Empire | null): string[] {
    let first = `${troops.length} ${T('troops', 'troops')}`;
    const c = troopCountsByType(troops);
    const text = troopCompositionDescription(c.infantry, c.artillery, c.armor, c.specialForces);
    if (text !== '') first += `: ${text}`;
    return [
        first,
        `${T('Total Attack Strength', 'Total Attack Strength')}: ${formatThousandsK(totalStrength(troops, true))}`,
        `${T('Total Defend Strength', 'Total Defend Strength')}: ${formatThousandsK(totalStrength(troops, false))}`,
        `${T('Annual Maintenance Costs', 'Annual Maintenance Costs')}: ${formatThousandsK(troopListAnnualMaintenance(troops, player))}`,
    ];
}

// ---------------------------------------------------------------------------------------------------------------
// Filter (FleetHabitatDropDown.cs:89 BindData; Main.Part11.cs:3637 cmbTroopFilter_SelectedIndexChanged)
// ---------------------------------------------------------------------------------------------------------------

export type TroopFilter = { kind: 'all' } | { kind: 'fleet'; fleet: ShipGroup } | { kind: 'colony'; colony: Habitat };

/**
 * FleetHabitatDropDown.cs:89 BindData(PlayerEmpire.ShipGroups, PlayerEmpire.Colonies, provideNullSelection: true):
 * the null entry (all troops), the fleets in ShipGroupList.Sort order, then the colonies by name
 * (HabitatList.cs:351 OrderByName). The C# sorts the empire's own fleet list in place; this sorts a copy.
 */
export function troopFilterOptions(empire: Empire): TroopFilter[] {
    const out: TroopFilter[] = [{ kind: 'all' }];
    const fleets = empireShipGroups(empire).filter((f): f is ShipGroup => f !== null);
    netSort(fleets, compareShipGroups);
    for (const fleet of fleets) out.push({ kind: 'fleet', fleet });
    const names = empire.colonies.map((colony) => ({ name: colony.name, colony }));
    netSort(names, (a, b) => NAME_COLLATOR.compare(a.name, b.name));
    for (const n of names) out.push({ kind: 'colony', colony: n.colony });
    return out;
}

/** Port of Main.Part11.cs:3637 cmbTroopFilter_SelectedIndexChanged: the troops the grid shows for a filter. */
export function troopsForFilter(player: Empire, filter: TroopFilter): Troop[] {
    const out: Troop[] = [];
    const addRange = (l: TroopList | null): void => {
        if (l !== null) for (const t of l.items) out.push(t);
    };
    if (filter.kind === 'fleet') {
        for (const bo of filter.fleet.ships) {
            if (bo != null && bo.troops != null && bo.troops.count > 0) addRange(bo.troops);
        }
    } else if (filter.kind === 'colony') {
        const h = filter.colony;
        if (h.empire === player) {
            const { defender, invader } = resolveInvasionEmpires(h);
            if (defender !== null && defender === player) {
                addRange(h.troops);
                addRange(h.troopsToRecruit);
            } else if (invader !== null && invader === player) {
                addRange(h.invadingTroops);
            }
        }
    } else {
        addRange(player.troops);
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Recruit (Main.Part3.cs:2759-2860 the selection panel's RecruitTroops buttons; 1767 their text)
// ---------------------------------------------------------------------------------------------------------------

export interface RecruitOption {
    /** The ShipAction the original's button carries (Target = colony, Target2 = the template troop, ExtraData). */
    action: ShipAction;
    troop: Troop;
    /** "Recruit Troops (NAME, TYPE)" (Main.Part3.cs:1767-1790). */
    label: string;
    /** 'clone' | 'robotic' | 'elite' | '' (Main.Part3.cs:2781-2792). */
    extra: string;
    /** The recruited troop's annual maintenance once trained (the grid's Maintenance formula for the template). */
    maintenance: number;
}

/**
 * Main.Part3.cs:2759-2860: for a colony the player owns (Habitat.Owner), ResolveRecruitableTroopsForColony and one
 * RecruitTroops button per template for the first five; clone / robotic / elite indices set ExtraData.
 * Recruiting has no purchase price in the C# (Main.Part7.cs:883-951 only queues the troop); the cost is the troop's
 * maintenance, charged once it is trained.
 */
export function recruitOptions(galaxy: Galaxy, player: Empire, habitat: Habitat): RecruitOption[] {
    const out: RecruitOption[] = [];
    if (habitat.owner !== player) return out;
    const r = resolveRecruitableTroopsForColony(galaxy, habitat);
    for (let m = 0; m < r.troops.length && m <= 4; m++) {
        const troop = r.troops[m];
        if (troop == null) continue;
        const action = createShipAction(ShipActionType.RecruitTroops, habitat);
        action.target2 = troop;
        let extra = '';
        if (r.cloneIndex === m) extra = 'clone';
        else if (r.roboticIndex === m) extra = 'robotic';
        else if (r.eliteIndex === m) extra = 'elite';
        if (extra !== '') action.extraData = extra;
        // Template troops have Readiness 0 / no colony TroopsToRecruit membership, so beingRecruited is false.
        out.push({
            action,
            troop,
            label: `${T('Recruit Troops', 'Recruit Troops')} (${troop.name}, ${troopTypeDescription(troop.type)})`,
            extra,
            maintenance: troopRowMaintenance(troop),
        });
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Disband / garrison / rename (Main.Part9.cs:4070, Main.Part11.cs:3684 / 3707, Main.Part9.cs:4140)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Port of Main.Part9.cs:4070 btnTroopDisband_Click after the automation prompt: removes each selected player troop
 * from its colony's Troops / TroopsToRecruit, its ship's Troops and the empire's Troops, and clears its
 * BuiltObject / Colony / AwaitingPickup / Empire. Returns the empire-list index the C# reselects (lowest selected
 * index − 1; −1 for none).
 */
export function disbandTroops(player: Empire, selected: readonly Troop[]): number {
    if (selected.length <= 0) return -1;
    let num = Number.MAX_SAFE_INTEGER;
    if (player.troops !== null) {
        for (const t of selected) {
            const num2 = player.troops.items.indexOf(t);
            if (num2 < num) num = num2;
        }
        num--;
    }
    for (const troop of selected) {
        if (troop == null || troop.empire !== player) continue;
        const colony = troop.colony as Habitat | null;
        if (colony !== null && colony.troops !== null && colony.troopsToRecruit !== null) {
            if (colony.troops.contains(troop)) colony.troops.remove(troop);
            else if (colony.troopsToRecruit.contains(troop)) colony.troopsToRecruit.remove(troop);
        }
        const bo = troop.builtObject as BuiltObject | null;
        if (bo !== null && bo.troops != null && bo.troops.contains(troop)) bo.troops.remove(troop);
        const empireTroops = (troop.empire as Empire).troops;
        if (empireTroops.contains(troop)) empireTroops.remove(troop);
        troop.builtObject = null;
        troop.colony = null;
        troop.awaitingPickup = false;
        troop.empire = null;
    }
    return num;
}

/** Port of Main.Part11.cs:3707 btnTroopGarrison_Click / 3684 btnTroopUngarrison_Click: only troops at a player colony. */
export function setTroopsGarrisoned(player: Empire, selected: readonly Troop[], garrisoned: boolean): number {
    let changed = 0;
    for (const troop of selected) {
        const colony = troop?.colony as Habitat | null;
        if (troop != null && troop.atColony && colony !== null && colony.empire === player) {
            troop.garrisoned = garrisoned;
            changed++;
        }
    }
    return changed;
}

/** Port of Main.Part9.cs:4140 (txtTroopInfoName change): a non-blank name renames the selected troop. */
export function renameTroop(troop: Troop | null, text: string): boolean {
    if (troop === null || text.trim() === '') return false;
    troop.name = text;
    return true;
}

/** The label of a filter entry (FleetHabitatDropDown.cs:163 OnDrawItem: "(None)" for the null entry = all troops). */
export function troopFilterLabel(f: TroopFilter): string {
    if (f.kind === 'fleet') return f.fleet.name ?? '';
    if (f.kind === 'colony') return f.colony.name;
    return `(${T('None', 'None')})`;
}

// ---------------------------------------------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------------------------------------------

export interface TroopsScreenOptions {
    galaxy: Galaxy;
    /** The player's empire. */
    empire: Empire;
    /** Go to Troop (Main.Part9.cs:4150): move the view to the troop's colony or ship. */
    onGoTo: (target: Habitat | BuiltObject) => void;
    /** GenerateAutomationMessageBox: resolves true for "turn automation off". */
    confirmAutomationOff?: (task: string) => Promise<boolean>;
    /** Refresh period in ms (default 1000). */
    refreshMs?: number;
}

interface OpenState {
    close: () => void;
}

let open: OpenState | null = null;

/** Open the Troops screen, or close it if it is already open (Main.Part9.cs:3129 tbtnTroops_Click). */
export function toggleTroopsScreen(opts: TroopsScreenOptions): void {
    if (open) open.close();
    else open = createTroopsScreen(opts);
}

/** Close the Troops screen (no-op when closed). */
export function closeTroopsScreen(): void {
    open?.close();
}

export function isTroopsScreenOpen(): boolean {
    return open !== null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

function sameFilter(a: TroopFilter, b: TroopFilter): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'fleet') return a.fleet === (b as { fleet: ShipGroup }).fleet;
    if (a.kind === 'colony') return a.colony === (b as { colony: Habitat }).colony;
    return true;
}

function createTroopsScreen(opts: TroopsScreenOptions): OpenState {
    const { galaxy, empire } = opts;
    let filter: TroopFilter = { kind: 'all' };
    let sortKey: TroopSortKey | null = null;
    let sortDesc = false;
    let selected = new Set<Troop>();
    let anchor: Troop | null = null;
    let shownOrder: Troop[] = [];
    let recruitSig = '';

    const root = el('div', 'troops-wrap');
    const win = el('div', 'troops-window');
    const titlebar = el('div', 'troops-titlebar');
    const heading = el('div', 'troops-heading', T('Troops', 'Troops'));
    const closeBtn = el('button', 'troops-close', '✕');
    closeBtn.type = 'button';
    closeBtn.title = 'Close';
    titlebar.append(heading, closeBtn);

    const body = el('div', 'troops-body');
    const side = el('div', 'troops-filter');
    const main = el('div', 'troops-main');
    body.append(side, main);

    const summary = el('div', 'troops-summary');
    const nameBar = el('div', 'troops-namebar');
    const nameLabel = el('label', 'troops-name-label', T('Name', 'Name'));
    const nameInput = el('input', 'troops-name-input');
    nameInput.type = 'text';
    nameInput.maxLength = 100;
    nameBar.append(nameLabel, nameInput);

    const grid = el('div', 'troops-grid');
    const header = el('div', 'troops-row troops-header');
    header.appendChild(el('span', 'troops-cell troops-flag'));
    const headerCells = new Map<TroopSortKey, HTMLElement>();
    for (const col of TROOP_COLUMNS) {
        const h = el('span', `troops-cell troops-sortable${col.numeric ? ' troops-num' : ''}`, T(col.label, col.label));
        h.addEventListener('click', () => {
            if (sortKey === col.key) sortDesc = !sortDesc;
            else {
                sortKey = col.key;
                sortDesc = false;
            }
            refresh();
        });
        headerCells.set(col.key, h);
        header.appendChild(h);
    }
    const rowsBox = el('div', 'troops-rows');
    const empty = el('div', 'troops-empty', 'No troops');
    grid.append(header, rowsBox);

    const buttons = el('div', 'troops-buttons');
    const mkBtn = (text: string): HTMLButtonElement => {
        const b = el('button', 'troops-btn', text);
        b.type = 'button';
        buttons.appendChild(b);
        return b;
    };
    const btnGoto = mkBtn(T('Go to Troop', 'Go to Troop'));
    const btnDisband = mkBtn(T('Disband Selected Troops', 'Disband Selected Troops'));
    const btnGarrison = mkBtn(T('Garrison selected troops', 'Garrison selected troops'));
    const btnUngarrison = mkBtn(T('Ungarrison selected troops', 'Ungarrison selected troops'));

    const recruitBox = el('div', 'troops-recruit');

    main.append(summary, nameBar, grid, buttons, recruitBox);
    win.append(titlebar, body);
    root.appendChild(win);
    document.body.appendChild(root);

    // --- filter list ---
    const filterRows = new Map<HTMLElement, TroopFilter>();
    function renderFilters(): void {
        const options = troopFilterOptions(empire);
        if (!options.some((o) => sameFilter(o, filter))) filter = { kind: 'all' };
        side.replaceChildren();
        filterRows.clear();
        let lastKind = '';
        for (const o of options) {
            if (o.kind !== lastKind && o.kind !== 'all') {
                side.appendChild(el('div', 'troops-filter-group', o.kind === 'fleet' ? T('Fleets', 'Fleets') : T('Colonies', 'Colonies')));
            }
            lastKind = o.kind;
            const row = el('div', 'troops-filter-row');
            const label = el('span', 'troops-filter-name', troopFilterLabel(o));
            const count = el('span', 'troops-filter-count');
            row.append(label, count);
            if (sameFilter(o, filter)) row.classList.add('selected');
            row.addEventListener('click', () => {
                filter = o;
                selected = new Set();
                anchor = null;
                for (const r of filterRows.keys()) r.classList.toggle('selected', r === row);
                recruitSig = '';
                refresh();
            });
            filterRows.set(row, o);
            side.appendChild(row);
        }
    }
    function updateFilterCounts(): void {
        for (const [row, f] of filterRows) {
            (row.lastChild as HTMLElement).textContent = String(troopsForFilter(empire, f).length);
        }
    }

    // --- grid rows (refreshed in place, keyed by troop) ---
    interface RowEls { line: HTMLElement; cells: HTMLElement[] }
    const rowEls = new Map<Troop, RowEls>();
    function makeRow(troop: Troop): RowEls {
        const line = el('div', 'troops-row troops-line');
        const cells: HTMLElement[] = [];
        const flag = el('span', 'troops-cell troops-flag');
        line.appendChild(flag);
        cells.push(flag);
        for (const col of TROOP_COLUMNS) {
            const c = el('span', `troops-cell${col.numeric ? ' troops-num' : ''}`);
            line.appendChild(c);
            cells.push(c);
        }
        line.addEventListener('click', (e) => onRowClick(troop, e));
        line.addEventListener('dblclick', () => goTo());
        return { line, cells };
    }
    function setText(e: HTMLElement, t: string): void {
        if (e.textContent !== t) {
            e.textContent = t;
            e.title = t;
        }
    }
    function fillRow(r: RowEls, row: TroopRow): void {
        const empireObj = row.troop.empire as Empire | null;
        r.cells[0].style.background = empireObj !== null ? cssColor(empireObj.mainColor) : 'transparent';
        r.cells[0].title = row.empireName;
        setText(r.cells[1], row.name);
        r.cells[1].classList.toggle('troops-garrisoned', row.garrisoned);
        r.cells[1].title = row.garrisoned ? T('This troop is garrisoned at this location', 'This troop is garrisoned at this location') : row.name;
        setText(r.cells[2], row.experience);
        setText(r.cells[3], row.type);
        setText(r.cells[4], formatTroopNumber(row.readiness));
        setText(r.cells[5], formatTroopNumber(row.attack));
        setText(r.cells[6], formatTroopNumber(row.defend));
        setText(r.cells[7], formatTroopNumber(row.maintenance));
        setText(r.cells[8], row.location);
        r.line.classList.toggle('selected', selected.has(row.troop));
    }

    function onRowClick(troop: Troop, e: MouseEvent): void {
        if (e.shiftKey && anchor !== null && shownOrder.includes(anchor)) {
            const a = shownOrder.indexOf(anchor);
            const b = shownOrder.indexOf(troop);
            selected = new Set(shownOrder.slice(Math.min(a, b), Math.max(a, b) + 1));
        } else if (e.ctrlKey || e.metaKey) {
            if (selected.has(troop)) selected.delete(troop);
            else selected.add(troop);
            anchor = troop;
        } else {
            selected = new Set([troop]);
            anchor = troop;
        }
        refresh();
    }

    /** ctlTroopList.SelectedTroop: the first selected troop in display order. */
    function selectedTroop(): Troop | null {
        for (const t of shownOrder) if (selected.has(t)) return t;
        return null;
    }
    function selectedTroops(): Troop[] {
        return shownOrder.filter((t) => selected.has(t));
    }

    let lastNameTroop: Troop | null = null;
    function refresh(): void {
        const troops = troopsForFilter(empire, filter);
        const rows = sortTroopRows(troopRows(troops), sortKey, sortDesc);
        shownOrder = rows.map((r) => r.troop);
        const alive = new Set(shownOrder);
        for (const t of [...selected]) if (!alive.has(t)) selected.delete(t);
        for (const [t, r] of rowEls) {
            if (!alive.has(t)) {
                r.line.remove();
                rowEls.delete(t);
            }
        }
        let prev: Element | null = null;
        for (const row of rows) {
            let r = rowEls.get(row.troop);
            if (r === undefined) {
                r = makeRow(row.troop);
                rowEls.set(row.troop, r);
            }
            fillRow(r, row);
            const want: Element | null = prev === null ? rowsBox.firstElementChild : prev.nextElementSibling;
            if (want !== r.line) rowsBox.insertBefore(r.line, want);
            prev = r.line;
        }
        if (rows.length === 0) {
            if (empty.parentElement !== rowsBox) rowsBox.appendChild(empty);
        } else empty.remove();

        const lines = troopSummaryLines(troops, empire);
        if (summary.childElementCount !== lines.length) summary.replaceChildren(...lines.map(() => el('div', 'troops-summary-line')));
        lines.forEach((l, i) => setText(summary.children[i] as HTMLElement, l));
        heading.textContent = `${T('Troops', 'Troops')} — ${troopFilterLabel(filter)}`;

        for (const [k, h] of headerCells) {
            h.classList.toggle('sorted-asc', sortKey === k && !sortDesc);
            h.classList.toggle('sorted-desc', sortKey === k && sortDesc);
        }
        const sel = selectedTroop();
        if (sel !== lastNameTroop && document.activeElement !== nameInput) {
            nameInput.value = sel?.name ?? '';
            lastNameTroop = sel;
        }
        const any = selected.size > 0;
        btnGoto.disabled = sel === null;
        btnDisband.disabled = !any;
        btnGarrison.disabled = !any;
        btnUngarrison.disabled = !any;
        nameInput.disabled = sel === null;
        updateFilterCounts();
        refreshRecruit();
    }

    function refreshRecruit(): void {
        const opts2 = filter.kind === 'colony' ? recruitOptions(galaxy, empire, filter.colony) : [];
        const sig = opts2.map((o) => `${o.label}|${o.extra}|${Math.round(o.maintenance)}`).join(';');
        if (sig === recruitSig) return;
        recruitSig = sig;
        recruitBox.replaceChildren();
        if (opts2.length === 0) {
            recruitBox.style.display = 'none';
            return;
        }
        recruitBox.style.display = '';
        recruitBox.appendChild(el('div', 'troops-recruit-title', `${T('Recruit Troops', 'Recruit Troops')} — ${troopFilterLabel(filter)}`));
        for (const o of opts2) {
            const b = el('button', 'troops-btn troops-recruit-btn');
            b.type = 'button';
            const name = el('span', 'troops-recruit-name', `${o.troop.name}, ${troopTypeDescription(o.troop.type)}`);
            const stats = el('span', 'troops-recruit-stats', `${o.troop.attackStrength} / ${o.troop.defendStrength} · ${T('Maintenance', 'Maintenance')} ${formatTroopNumber(o.maintenance)}`);
            b.append(name, stats);
            b.title = o.label;
            b.addEventListener('click', () => void recruit(o));
            recruitBox.appendChild(b);
        }
    }

    async function recruit(o: RecruitOption): Promise<void> {
        if (filter.kind !== 'colony') return;
        const r = executeShipAction(galaxy, empire, filter.colony, o.action, false, {});
        refresh();
        for (const task of r.automationPrompts) {
            if (opts.confirmAutomationOff && (await opts.confirmAutomationOff(T(task, task)))) applyAutomationOff(empire, task);
        }
    }

    function goTo(): void {
        const t = selectedTroop();
        if (t !== null) {
            const target = t.atColony ? (t.colony as Habitat | null) : (t.builtObject as BuiltObject | null);
            close();
            if (target !== null) opts.onGoTo(target);
            return;
        }
        close();
    }

    async function disband(): Promise<void> {
        // Main.Part9.cs:4072: the automation prompt comes first.
        if (empire.controlTroopGeneration && opts.confirmAutomationOff && (await opts.confirmAutomationOff(T('Troop Recruitment', 'Troop Recruitment')))) {
            empire.controlTroopGeneration = false;
        }
        const list = selectedTroops();
        if (list.length <= 0) return;
        const num = disbandTroops(empire, list);
        // The C# rebinds to all troops and reselects the troop at index num.
        filter = { kind: 'all' };
        renderFilters();
        selected = new Set();
        if (num >= 0 && num < empire.troops.count) selected.add(empire.troops.items[num]);
        refresh();
    }

    btnGoto.addEventListener('click', goTo);
    btnDisband.addEventListener('click', () => void disband());
    btnGarrison.addEventListener('click', () => {
        setTroopsGarrisoned(empire, selectedTroops(), true);
        refresh();
    });
    btnUngarrison.addEventListener('click', () => {
        setTroopsGarrisoned(empire, selectedTroops(), false);
        refresh();
    });
    nameInput.addEventListener('input', () => {
        if (renameTroop(selectedTroop(), nameInput.value)) refresh();
    });

    renderFilters();
    refresh();
    let lastFilterSig = filterSignature();
    function filterSignature(): string {
        return troopFilterOptions(empire).map((o) => troopFilterLabel(o)).join('|');
    }
    const timer = setInterval(() => {
        const sig = filterSignature();
        if (sig !== lastFilterSig) {
            lastFilterSig = sig;
            renderFilters();
        }
        refresh();
    }, opts.refreshMs ?? 1000);

    function close(): void {
        clearInterval(timer);
        document.removeEventListener('keydown', onKeyDown);
        root.remove();
        open = null;
    }
    function onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            close();
        }
    }
    document.addEventListener('keydown', onKeyDown);
    closeBtn.addEventListener('click', () => close());
    return { close };
}

/** Empire.mainColor (packed RGB) as CSS; the flag column's swatch (the C# draws SmallFlagPicture). */
function cssColor(c: number): string {
    return `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
}
