// Troops screen: a port of the original's Troops panel on the shared original-style window (originalWindow.ts).
// Main.Part9.cs:3129 tbtnTroops_Click toggles pnlTroopInfo; Main.Part11.cs:3730 method_172 lays it out (1065 × 700,
// every control at its source Location / Size), 3637 cmbTroopFilter_SelectedIndexChanged fills it, 3611 method_171
// writes the summary, 3808 ctlTroopList_SelectionChanged follows the selection; TroopListView.cs for the columns.
// The original has no hotkey for it (Main_KeyUp has no case; its hover hint "Open Troops screen" carries no key).
//
// Layout (body pixels): "Learn about Troops..." (10, 9), the summary (380, 9), "Filter by" (780, 14) + the
// FleetHabitatDropDown (840, 10) ("(None)" = all troops, then the fleets, then the colonies by name), the Name box
// (60, 43), the troop grid (10, 73) 720 × 519 (Empire / Name / Experience / Type / Readiness / Attack / Defend /
// Maintenance / Location; MultiSelect; header click sorts), the mini galaxy map (740, 88) 300 × 300 with the
// crosshair on the selected troop, and the four buttons at y 602 (Go to Troop, Disband, Garrison, Ungarrison).
//
// Our extras, in the same chrome, in the space the original leaves empty under the map: the troop pictures (a
// small one in the Name cell, a large one in the detail block), the selected troop's detail (experience, type,
// strengths, readiness / recruitment progress bar, location) and, when the filter is a colony the player owns, its
// recruit options (the selection panel's five RecruitTroops buttons, Main.Part3.cs:2759-2860, through
// executeShipAction, Main.Part7.cs:883-951) with the colony's recruitment progress.
//
// TODO(port): AutoPauseWhenInPopupWindow pause/resume — Main.Part11.cs:3733 / 4661 method_184
// TODO(port): the galaxy nebula image on the mini map (GalaxyMap.cs bitmap_0, as in galaxyMap.ts) — GalaxyMap.cs method_6

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
import type { ShipActionResult } from '../../sim/player/executeShipAction';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { resolveRecruitableTroopsForColony } from '../../sim/player/orderMenu';
import { formatThousandsK } from './coloniesList';
import { disbandTroops, setTroopsGarrisoned, renameTroop } from '../../sim/player/playerOrders';
import { troopImageUrl, wireTroopImageFallback } from '../../render/troopImages';
import { raceHasConcordArt } from '../../render/concordArt';
import { BACKDROP_URLS } from '../../render/assets';
import { CROSSHAIR_COLOR, GRID_COLOR, galaxyMapScale, starBrushColor, starDotSizes } from './galaxyMap';
import { openGalactopedia } from './galactopedia';
import { empireFlagUrl } from '../selectionInfoView';
import {
    COLORS,
    FONT,
    OwGrid,
    barGraph,
    darkRect,
    dropDown,
    dropText,
    el,
    glassButton,
    linkLabel,
    openOriginalWindow,
    place,
    setText,
    text,
    textBox,
} from '../originalWindow';
export { disbandTroops, setTroopsGarrisoned, renameTroop };

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
        case TroopType.Armored: return T('TroopType Armored', 'Armored Forces');
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

/** The label of a filter entry (FleetHabitatDropDown.cs:163 OnDrawItem: "(None)" for the null entry = all troops). */
export function troopFilterLabel(f: TroopFilter): string {
    if (f.kind === 'fleet') return f.fleet.name ?? '';
    if (f.kind === 'colony') return f.colony.name;
    return `(${T('None', 'None')})`;
}

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers of the window (tested)
// ---------------------------------------------------------------------------------------------------------------

/** Main.Part9.cs:4150 btnTroopGoto_Click / ctlTroopList_SelectionChanged: the troop's colony while AtColony, else its ship. */
export function troopGoToTarget(troop: Troop): Habitat | BuiltObject | null {
    if (troop.atColony) return (troop.colony as Habitat | null) ?? null;
    return (troop.builtObject as BuiltObject | null) ?? null;
}

/** Galaxy.7.cs:5467's type abbreviations (Inf / Arm / PDU / SF); Pirate Raiders have none in the source. */
export function troopTypeAbbreviation(type: TroopType): string {
    switch (type) {
        case TroopType.Infantry: return T('TroopType Infantry Abbreviation', 'Inf');
        case TroopType.Armored: return T('TroopType Armored Abbreviation', 'Arm');
        case TroopType.Artillery: return T('TroopType Artillery Abbreviation', 'PDU');
        case TroopType.SpecialForces: return T('TroopType SpecialForces Abbreviation', 'SF');
        case TroopType.PirateRaider: return T('TroopType PirateRaider', 'Pirate Raider');
    }
    return '';
}

/** GalaxyMap.cs SetPosition + method_6 crosshair: a world point in the `mapPx`-wide mini map (trunc(x / scale) + 1). */
export function miniMapPoint(galaxySizeX: number, mapPx: number, x: number, y: number): { x: number; y: number } {
    const s = galaxySizeX / mapPx;
    return { x: Math.trunc(x / s) + 1, y: Math.trunc(y / s) + 1 };
}

/** The dropdown value of a filter entry (stable while the entry exists). */
export function troopFilterValue(f: TroopFilter, index: number): string {
    return f.kind === 'all' ? 'all' : `${f.kind}:${index}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The window (Main.Part11.cs:3730 method_172: pnlTroopInfo 1065 × 700)
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

/** pnlTroopInfo.Size (method_172). */
const WINDOW_W = 1065;
const WINDOW_H = 700;
/** dboYnQplv3: the GalaxyMap control, 300 × 300 at (740, 88), 2 px (67, 67, 77) border. */
const MAP = { x: 740, y: 88, size: 300 };
/** TroopListView.BindData: _GarrisonStyle.ForeColor. */
const GARRISON_COLOR = 'rgb(0, 255, 0)';

const backdrop: { img: HTMLImageElement | null } = { img: null };

function createTroopsScreen(opts: TroopsScreenOptions): OpenState {
    const { galaxy, empire } = opts;
    const raceCount = galaxy.races.length;
    let filter: TroopFilter = { kind: 'all' };
    let filterOptions: TroopFilter[] = [];
    let filterSig = '';
    let recruitSig = '';
    let lastNameTroop: Troop | null = null;
    let timer = 0;

    const win = openOriginalWindow({
        id: 'troops',
        title: T('Troops', 'Troops'),
        icon: 'troops.png',
        width: WINDOW_W,
        height: WINDOW_H,
        onClose: () => {
            window.clearInterval(timer);
            open = null;
        },
        onResize: () => drawMap(),
    });
    const body = win.body;

    // lnkTroops (10, 9): Main.Part4.cs:2138 lnkTroops_LinkClicked → the Galactopedia's "Troops" topic.
    body.appendChild(place(linkLabel(`${T('Learn about Troops', 'Learn about Troops')}...`, () => openGalactopedia({ topic: T('Troops', 'Troops') }), FONT.normal), 10, 9));

    // lblTroopSummary (380, 9): font_3 (15.33), color_2 (170, 170, 170); method_171's four lines.
    const summary = text('', { size: FONT.normal, color: COLORS.label, wrapWidth: 390, className: 'tr-summary' });
    body.appendChild(place(summary, 380, 9));

    // lblTroopFilter (780, 14) "Filter by" + cmbTroopFilter (840, 10) 200 × 21, font_6 (16.67).
    dropText(body, T('Filter by', 'Filter by'), 780, 14, { size: FONT.large, color: COLORS.label });
    let filterSel = dropDown([], '', () => undefined);
    body.appendChild(filterSel);

    // lblTroopInfoName (10, 46) font_2 (18.67 bold) color_1 (120, 120, 120); txtTroopInfoName (60, 43) 250 × 20 font_7.
    dropText(body, T('Name', 'Name'), 10, 46, { size: FONT.header, bold: true, color: 'rgb(120, 120, 120)' });
    const nameInput = textBox('', '', (v) => {
        // IgqymUpftW: rename the selected troop while the text is not blank.
        const t = singleSelected();
        if (t !== null && v.trim() !== '') issuePlayerCommand(galaxy, empire, 'renameTroop', [t.troop, v], (ok) => ok && refresh());
    });
    nameInput.maxLength = 100;
    nameInput.style.fontSize = `${FONT.large}px`;
    nameInput.style.fontWeight = 'bold';
    body.appendChild(place(nameInput, 60, 43, 250, 20));

    // ctlTroopList (10, 73) 720 × 519; column widths from method_172 (Location fills what the scrollbar leaves).
    const flagCache = new Map<Empire, string>();
    const grid = new OwGrid<TroopRow>({
        key: (r) => r.troop,
        multiSelect: true,
        rowHeight: 20,
        fontSize: FONT.normal,
        empty: '',
        columns: [
            {
                id: 'empire',
                header: '',
                width: 30,
                align: 'center',
                render: (r, cell) => {
                    const emp = r.troop.empire as Empire | null;
                    cell.title = r.empireName;
                    if (emp === null) return;
                    const im = el('img', 'tr-flag');
                    im.alt = '';
                    const cached = flagCache.get(emp);
                    if (cached) im.src = cached;
                    else
                        void empireFlagUrl(galaxy, emp).then((u) => {
                            flagCache.set(emp, u);
                            im.src = u;
                        });
                    cell.appendChild(im);
                },
            },
            {
                id: 'name',
                header: T('Name', 'Name'),
                width: 160,
                sort: (r) => r.name,
                render: (r, cell) => {
                    // Our extra: the troop's race / type picture (InfoPanel.cs DrawTroopsAgents) before the name.
                    cell.appendChild(troopPicture(r.troop, 'tr-pic'));
                    cell.append(r.name);
                    if (r.garrisoned) {
                        cell.classList.add('tr-garrison');
                        cell.title = T('This troop is garrisoned at this location', 'This troop is garrisoned at this location');
                    } else cell.title = r.name;
                },
            },
            { id: 'experience', header: T('Experience', 'Experience'), width: 80, sort: (r) => r.experience, render: (r, cell) => cell.append(r.experience) },
            { id: 'type', header: T('Type', 'Type'), width: 100, sort: (r) => r.type, render: (r, cell) => { cell.append(r.type); cell.title = r.type; } },
            { id: 'readiness', header: T('Readiness', 'Readiness'), title: T('Readiness', 'Readiness'), width: 50, align: 'right', sort: (r) => r.readiness, render: (r, cell) => cell.append(formatTroopNumber(r.readiness)) },
            { id: 'attack', header: T('Attack Strength', 'Attack Strength'), title: T('Attack Strength', 'Attack Strength'), width: 50, align: 'right', sort: (r) => r.attack, render: (r, cell) => cell.append(formatTroopNumber(r.attack)) },
            { id: 'defend', header: T('Defend Strength', 'Defend Strength'), title: T('Defend Strength', 'Defend Strength'), width: 50, align: 'right', sort: (r) => r.defend, render: (r, cell) => cell.append(formatTroopNumber(r.defend)) },
            { id: 'maintenance', header: T('Maintenance', 'Maintenance'), width: 80, align: 'right', sort: (r) => r.maintenance, render: (r, cell) => cell.append(formatTroopNumber(r.maintenance)) },
            { id: 'location', header: T('Location', 'Location'), fill: 1, sort: (r) => r.location, render: (r, cell) => { cell.append(r.location); cell.title = r.location; } },
        ],
        onSelect: () => selectionChanged(),
        onDoubleClick: () => goTo(),
    });
    body.appendChild(place(grid.el, 10, 73, 720, 519));
    grid.el.classList.add('tr-grid');

    // lblTroopsGalaxyMapTitle (740, 70) + dboYnQplv3 (740, 88) 300 × 300.
    dropText(body, T('Location of selected Troops in Galaxy', 'Location of selected Troops in Galaxy'), 740, 70, { size: FONT.normal, color: COLORS.label });
    const mapBox = place(el('div', 'tr-map'), MAP.x, MAP.y, MAP.size, MAP.size);
    const canvas = el('canvas', 'tr-map-canvas');
    mapBox.appendChild(canvas);
    body.appendChild(mapBox);
    let mapPoint: { x: number; y: number } | null = null;

    // Our extra below the map: the selected troop(s) and the colony's recruit options.
    const detail = place(darkRect(), 740, 398, 300, 98);
    body.appendChild(detail);
    const recruitBox = place(el('div', 'tr-recruit'), 740, 502, 300, 125);
    body.appendChild(recruitBox);

    // btnTroopGoto (10, 602) 130 × 25, btnTroopDisband (150, 602) 180, btnTroopGarrison (340, 602) 180,
    // btnTroopUngarrison (530, 602) 200.
    const btnGoto = glassButton(T('Go to Troop', 'Go to Troop'), { onClick: () => goTo() });
    const btnDisband = glassButton(T('Disband Selected Troops', 'Disband Selected Troops'), { onClick: () => void disband() });
    const btnGarrison = glassButton(T('Garrison selected troops', 'Garrison selected troops'), { onClick: () => garrison(true) });
    const btnUngarrison = glassButton(T('Ungarrison selected troops', 'Ungarrison selected troops'), { onClick: () => garrison(false) });
    body.append(place(btnGoto, 10, 602, 130, 25), place(btnDisband, 150, 602, 180, 25), place(btnGarrison, 340, 602, 180, 25), place(btnUngarrison, 530, 602, 200, 25));

    function troopPicture(t: Troop, cls: string): HTMLImageElement {
        const img = el('img', cls);
        img.alt = '';
        img.draggable = false;
        const concordArt = raceHasConcordArt(galaxy, (t.race as Race | null)?.name);
        img.src = troopImageUrl(t, raceCount, { concordArt });
        wireTroopImageFallback(img, t, raceCount, { concordArt });
        return img;
    }

    // --- filter (FleetHabitatDropDown.BindData; rebuilt when the fleets / colonies change) ---
    function renderFilter(): void {
        const options = troopFilterOptions(empire);
        const sig = options.map((o) => troopFilterLabel(o)).join('|');
        if (sig === filterSig && filterOptions.length === options.length) return;
        filterSig = sig;
        if (!options.some((o) => sameFilter(o, filter))) filter = { kind: 'all' };
        filterOptions = options;
        const values = options.map((o, i) => ({ value: troopFilterValue(o, i), label: troopFilterLabel(o) }));
        const current = values[Math.max(0, options.findIndex((o) => sameFilter(o, filter)))].value;
        const next = dropDown(values, current, (v) => {
            const i = values.findIndex((x) => x.value === v);
            filter = options[i] ?? { kind: 'all' };
            recruitSig = '';
            grid.select(undefined, false);
            refresh();
        });
        next.style.fontSize = `${FONT.large}px`;
        place(next, 840, 10, 200, 21);
        filterSel.replaceWith(next);
        filterSel = next;
    }

    /** ctlTroopList.SelectedTroop: a row only while exactly one is selected (SelectedRows.Count == 1). */
    function singleSelected(): TroopRow | null {
        const all = grid.selectedAll;
        return all.length === 1 ? all[0] : null;
    }

    function selectedTroops(): Troop[] {
        return grid.selectedAll.map((r) => r.troop);
    }

    function refresh(): void {
        renderFilter();
        const troops = troopsForFilter(empire, filter);
        grid.setRows(troopRows(troops));
        const lines = troopSummaryLines(troops, empire);
        setText(summary, lines.join('\n'));
        updateControls();
        refreshDetail();
        refreshRecruit();
    }

    /** ctlTroopList_SelectionChanged: the name box and the map position follow the single selected troop. */
    function selectionChanged(): void {
        updateControls();
        refreshDetail();
    }

    function updateControls(): void {
        const one = singleSelected();
        const t = one?.troop ?? null;
        if (t !== lastNameTroop && document.activeElement !== nameInput) {
            nameInput.value = t?.name ?? '';
            lastNameTroop = t;
        }
        const any = grid.selectedAll.length > 0;
        btnGoto.disabled = t === null;
        btnDisband.disabled = !any;
        btnGarrison.disabled = !any;
        btnUngarrison.disabled = !any;
        nameInput.disabled = t === null;
        const target = t !== null ? troopGoToTarget(t) : null;
        const p = target !== null ? miniMapPoint(galaxy.sizeX, MAP.size, target.xpos, target.ypos) : null;
        if (p?.x !== mapPoint?.x || p?.y !== mapPoint?.y) {
            mapPoint = p;
            drawMap();
        }
    }

    // --- mini galaxy map (GalaxyMap.cs method_6 at 300 px: backdrop, sector grid, systems, crosshair) ---
    function drawMap(): void {
        const px = Math.max(1, Math.round(MAP.size * win.scale * (window.devicePixelRatio || 1)));
        if (canvas.width !== px) {
            canvas.width = px;
            canvas.height = px;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const k = px / MAP.size;
        ctx.setTransform(k, 0, 0, k, 0, 0);
        const W = MAP.size;
        const s = galaxyMapScale(galaxy, W);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, W);
        if (backdrop.img === null) {
            const img = new Image();
            img.onload = () => {
                backdrop.img = img;
                if (!win.closed) drawMap();
            };
            img.src = BACKDROP_URLS[0];
        } else if (backdrop.img.complete) ctx.drawImage(backdrop.img, 0, 0, galaxy.sizeX / s, galaxy.sizeY / s);
        const sec = galaxy.sectorSize / s;
        ctx.strokeStyle = GRID_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= galaxy.sectorWidth; i++) {
            const x = Math.trunc(i * sec) + 0.5;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, Math.min(W, galaxy.sectorHeight * sec));
        }
        for (let j = 0; j <= galaxy.sectorHeight; j++) {
            const y = Math.trunc(j * sec) + 0.5;
            ctx.moveTo(0, y);
            ctx.lineTo(Math.min(W, galaxy.sectorWidth * sec), y);
        }
        ctx.stroke();
        const dot = starDotSizes(W, false).normal;
        for (const sys of galaxy.systems) {
            const c = starBrushColor(sys.systemStar);
            if (c === null) continue;
            ctx.fillStyle = c;
            ctx.fillRect(sys.systemStar.xpos / s - dot / 2, sys.systemStar.ypos / s - dot / 2, dot, dot);
        }
        if (mapPoint !== null) {
            ctx.strokeStyle = CROSSHAIR_COLOR;
            ctx.beginPath();
            ctx.moveTo(mapPoint.x + 0.5, 0);
            ctx.lineTo(mapPoint.x + 0.5, W);
            ctx.moveTo(0, mapPoint.y + 0.5);
            ctx.lineTo(W, mapPoint.y + 0.5);
            ctx.stroke();
        }
    }

    // --- selected troop detail (our extra) ---
    let detailSig = '';
    function refreshDetail(): void {
        const sel = selectedTroops();
        const one = sel.length === 1 ? sel[0] : null;
        const sig = one !== null
            ? `1|${one.name}|${one.type}|${Math.round(one.readiness)}|${Math.round(one.overallAttackStrength)}|${Math.round(one.overallDefendStrength)}|${troopLocation(one)}|${one.garrisoned}|${one.beingRecruited}`
            : `${sel.length}|${sel.map((t) => Math.round(t.readiness)).join(',')}`;
        if (sig === detailSig) return;
        detailSig = sig;
        detail.replaceChildren();
        if (one !== null) {
            detail.appendChild(place(troopPicture(one, 'tr-detail-pic'), 8, 9, 80, 80));
            const row = one;
            const r = troopRow(row);
            dropText(detail, r.name, 96, 6, { size: FONT.large, bold: true, color: r.garrisoned ? GARRISON_COLOR : 'rgb(255, 255, 255)' }).classList.add('tr-ellipsis');
            dropText(detail, [r.experience, r.type].filter((x) => x !== '').join(' '), 96, 26, { size: FONT.normal, color: COLORS.text });
            dropText(detail, `${T('Attack', 'Attack')} ${formatTroopNumber(r.attack)}  ·  ${T('Defend', 'Defend')} ${formatTroopNumber(r.defend)}`, 96, 43, { size: FONT.tiny, color: COLORS.label }).classList.add('tr-ellipsis');
            const label = row.beingRecruited ? T('Recruiting', 'Recruiting') : T('Readiness', 'Readiness');
            const barBox = place(el('div', 'tr-bar'), 96, 61, 196, 14);
            barBox.appendChild(barGraph(row.readiness, 100, 196, 14, row.beingRecruited ? 'rgb(255, 192, 0)' : COLORS.green));
            barBox.appendChild(place(text(`${label} ${formatTroopNumber(row.readiness)}%`, { size: FONT.tiny, color: COLORS.text }), 4, -1));
            detail.appendChild(barBox);
            const loc = r.location !== '' ? r.location : '';
            const where = row.garrisoned ? `${loc} (${T('Garrisoned', 'Garrisoned')})` : loc;
            dropText(detail, where, 96, 78, { size: FONT.tiny, color: COLORS.label }).classList.add('tr-ellipsis');
        } else if (sel.length > 1) {
            const lines = troopSummaryLines(sel, empire);
            dropText(detail, T('Selected Troops', 'Selected Troops'), 10, 8, { size: FONT.large, bold: true, color: 'rgb(255, 255, 255)' });
            dropText(detail, lines.join('\n'), 10, 28, { size: FONT.tiny, color: COLORS.label, wrapWidth: 280 });
        } else {
            dropText(detail, T('Select a troop to see its details', 'Select a troop to see its details'), 10, 40, { size: FONT.normal, color: 'rgb(120, 120, 120)' });
        }
    }

    // --- recruit at the filtered colony (our extra: the selection panel's RecruitTroops buttons) ---
    function refreshRecruit(): void {
        const colony = filter.kind === 'colony' ? filter.colony : null;
        const options = colony !== null ? recruitOptions(galaxy, empire, colony) : [];
        const training = colony !== null ? troopItemsOf(colony.troopsToRecruit) : [];
        const sig = `${colony?.name ?? ''}|${options.map((o) => `${o.label}|${o.extra}|${Math.round(o.maintenance)}`).join(';')}|${training.map((t) => Math.round(t.readiness)).join(',')}`;
        if (sig === recruitSig) return;
        recruitSig = sig;
        recruitBox.replaceChildren();
        if (colony === null || options.length === 0) {
            dropText(recruitBox, colony === null ? T('Filter by a colony to recruit troops there', 'Filter by a colony to recruit troops there') : T('No troops can be recruited here', 'No troops can be recruited here'), 0, 2, { size: FONT.normal, color: 'rgb(120, 120, 120)', wrapWidth: 300 });
            return;
        }
        dropText(recruitBox, `${T('Recruit Troops', 'Recruit Troops')}: ${colony.name}`, 0, 0, { size: FONT.normal, bold: true, color: COLORS.text }).classList.add('tr-ellipsis');
        options.forEach((o, i) => {
            const b = glassButton('', { onClick: () => void recruit(colony, o), title: `${o.label}\n${T('Attack Strength', 'Attack Strength')} ${o.troop.attackStrength} · ${T('Defend Strength', 'Defend Strength')} ${o.troop.defendStrength}\n${T('Maintenance', 'Maintenance')} ${formatTroopNumber(o.maintenance)}`, className: 'tr-recruit-btn' });
            b.appendChild(place(troopPicture(o.troop, 'tr-recruit-pic'), 6, 3, 44, 44));
            const cap = el('span', 'tr-recruit-cap', o.extra !== '' ? T(o.extra, o.extra.charAt(0).toUpperCase() + o.extra.slice(1)) : troopTypeAbbreviation(o.troop.type));
            b.appendChild(place(cap, 0, 48, 56, 14));
            recruitBox.appendChild(place(b, i * 61, 20, 56, 64));
        });
        const line = training.length > 0
            ? `${T('Recruiting', 'Recruiting')}: ${training.length}  (${training.map((t) => `${formatTroopNumber(t.readiness)}%`).join(', ')})`
            : `${T('Recruiting', 'Recruiting')}: 0`;
        dropText(recruitBox, line, 0, 90, { size: FONT.tiny, color: COLORS.label, wrapWidth: 300 }).classList.add('tr-ellipsis');
    }

    async function recruit(colony: Habitat, o: RecruitOption): Promise<void> {
        // Command log: queued, applied at the next frame boundary (Main.Part7.cs:883-951 via executeShipAction).
        const r = await new Promise<ShipActionResult>((resolve) => issuePlayerCommand(galaxy, empire, 'shipAction', [colony, o.action, false], resolve));
        if (win.closed) return;
        recruitSig = '';
        refresh();
        for (const task of r.automationPrompts) {
            if (opts.confirmAutomationOff && (await opts.confirmAutomationOff(T(task, task)))) issuePlayerCommand(galaxy, empire, 'automationOff', [task], () => !win.closed && refresh());
        }
    }

    function goTo(): void {
        // btnTroopGoto_Click: only with exactly one selected troop (SelectedTroop); always closes (method_184).
        const one = singleSelected();
        const target = one !== null ? troopGoToTarget(one.troop) : null;
        win.close();
        if (target !== null) opts.onGoTo(target);
    }

    async function disband(): Promise<void> {
        // Main.Part9.cs:4072: the automation prompt comes first.
        if (empire.controlTroopGeneration && opts.confirmAutomationOff && (await opts.confirmAutomationOff(T('Troop Recruitment', 'Troop Recruitment')))) {
            issuePlayerCommand(galaxy, empire, 'setEmpireControl', ['controlTroopGeneration', false]);
        }
        const list = selectedTroops();
        if (list.length <= 0 || win.closed) return;
        issuePlayerCommand(galaxy, empire, 'disbandTroops', [list], (num) => {
            if (win.closed) return;
            // The C# rebinds to all troops and reselects the troop at index num.
            filter = { kind: 'all' };
            filterSig = '';
            refresh();
            const next = num >= 0 && num < empire.troops.count ? empire.troops.items[num] : null;
            grid.select(next ?? undefined);
            selectionChanged();
        });
    }

    function garrison(on: boolean): void {
        issuePlayerCommand(galaxy, empire, 'garrisonTroops', [selectedTroops(), on], () => !win.closed && refresh());
    }

    refresh();
    drawMap();
    timer = window.setInterval(() => refresh(), opts.refreshMs ?? 1000);
    return { close: () => win.close() };
}

function troopItemsOf(list: TroopList | null): Troop[] {
    return list !== null ? list.items.filter((t): t is Troop => t != null) : [];
}

function sameFilter(a: TroopFilter, b: TroopFilter): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'fleet') return a.fleet === (b as { fleet: ShipGroup }).fleet;
    if (a.kind === 'colony') return a.colony === (b as { colony: Habitat }).colony;
    return true;
}
