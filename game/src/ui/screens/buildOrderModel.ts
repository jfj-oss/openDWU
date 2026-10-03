// Build Order screen model (pure: no DOM). The original's pnlBuildOrder, opened by the top bar's btnBuildOrder
// (Main.Part2.cs 1196 btnBuildOrder_Click → 404 method_628) or F9: one row per buildable ship sub-role with the current
// amount, the advisor's suggestion, the Order Amount spinner, the design drop-down and the purchase / maintenance
// costs, the totals, the available money / cashflow, and Purchase → Empire.6.cs 3017 BuildNewShips.
//
// Sources: Main.Part2.cs 404 method_628 (layout, the advisor amounts), 799 method_629 (a row), 873 method_630 (the
// design drop-down or its note), 911 method_631 / 929 method_632 / 950 method_633 (totals), 1003 method_634 (spinner
// colours), 1135 btnBuildOrderPurchase_Click / 1168 method_643 (the purchase lists).

import type { Empire } from '../../sim/empire';
import { AutomationLevel } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { Design } from '../../sim/design';
import { BuiltObjectSubRole } from '../../sim/builtObjectTypes';
import { findNewestCanBuild, getBuildableDesignsBySubRoles, resolveSubRoleDescription } from '../../sim/designGeneration';
import type { BuildNewShipsResult } from '../../sim/construction/empireConstruction';
import { buildOrderTotalCost, designCalculateMaintenanceCosts, refactorForceStructureProjectionsToCosts } from '../../sim/construction/empireConstruction';
import { checkPirateEmpireHasCriminalNetwork } from '../../sim/missions/cmdTroops';
import { currentPrivateForceStructure, currentStateForceStructure } from '../../sim/forceStructure';
import { ForceStructureProjectionList } from '../../sim/forceStructureProjection';
import { netSort } from '../../sim/netSort';
import { galaxyStarDate } from '../../sim/tick/simTime';
import { formatNet, resolveGameText, tryGetText } from '../../sim/textResolver';
import { formatThousands } from '../../sim/diplomacyTick';

// -------------------------------------------------------------------------------------------------------------------
// Text
// -------------------------------------------------------------------------------------------------------------------

/** GameText.txt entries the screen uses, for headless tests / before the table is loaded. */
const TEXT_FALLBACK: Record<string, string> = {
    'Build Order': 'Build Order',
    'Build Order Explanation':
        "Select a design and amount to build for each ship type below. Then click the 'Purchase' button to construct the new ships. \\nShips will be built at any available space ports and colonies throughout your empire.",
    'Current Amount': 'Current Amount',
    'Advisor Suggest': 'Advisor Suggest',
    'Order Amount': 'Order Amount',
    Design: 'Design',
    'Purchase Costs': 'Purchase Costs',
    'Maintenance Costs Abbreviated': 'Maint. Costs',
    'TOTAL Purchase and Maintenance Costs': 'TOTAL Purchase and Maintenance Costs',
    'Available Money and Cashflow': 'Available Money and Cashflow',
    'Purchase for X credits': 'Purchase for {0} credits',
    Purchase: 'Purchase',
    Cancel: 'Cancel',
    'No buildable designs': 'No buildable designs',
    'No construction yards for this ship type': 'No construction yards for this ship type',
    'Cannot afford build order': 'Cannot afford build order',
    'Build Order Purchase Cannot Afford':
        'We cannot afford to build all of these new ships. This order would cost {0} credits, but we only have {1} credits to spend.\\n\\nReduce your build order and try again.',
};

/** `string.Format(TextResolver.GetText(tag), args)` with GameText's literal `\n` as line breaks. */
export function bt(tag: string, ...args: unknown[]): string {
    return formatNet(tryGetText(tag) ?? TEXT_FALLBACK[tag] ?? tag, args).replace(/\\n/g, '\n');
}

// -------------------------------------------------------------------------------------------------------------------
// Rows
// -------------------------------------------------------------------------------------------------------------------

// Main.Part2.cs:404 method_628: the row order.
export const BUILD_ORDER_SUBROLES: readonly BuiltObjectSubRole[] = [
    BuiltObjectSubRole.Escort,
    BuiltObjectSubRole.Frigate,
    BuiltObjectSubRole.Destroyer,
    BuiltObjectSubRole.Cruiser,
    BuiltObjectSubRole.CapitalShip,
    BuiltObjectSubRole.TroopTransport,
    BuiltObjectSubRole.Carrier,
    BuiltObjectSubRole.ResupplyShip,
    BuiltObjectSubRole.ExplorationShip,
    BuiltObjectSubRole.ConstructionShip,
    BuiltObjectSubRole.SmallFreighter,
    BuiltObjectSubRole.MediumFreighter,
    BuiltObjectSubRole.LargeFreighter,
    BuiltObjectSubRole.MiningShip,
    BuiltObjectSubRole.GasMiningShip,
    BuiltObjectSubRole.PassengerShip,
];

// Main.Part2.cs:971 method_633: the private sub-roles, whose maintenance is 0.
export function isPrivateBuildSubRole(subRole: BuiltObjectSubRole): boolean {
    switch (subRole) {
        case BuiltObjectSubRole.SmallFreighter:
        case BuiltObjectSubRole.MediumFreighter:
        case BuiltObjectSubRole.LargeFreighter:
        case BuiltObjectSubRole.PassengerShip:
        case BuiltObjectSubRole.GasMiningShip:
        case BuiltObjectSubRole.MiningShip:
            return true;
        default:
            return false;
    }
}

// BaconMain.GetNumberOfShipsOfSubRole: PrivateBuiltObjects + BuiltObjects of that sub-role.
export function shipsOfSubRoleCount(empire: Empire, subRole: BuiltObjectSubRole): number {
    let num = 0;
    for (const bo of empire.privateBuiltObjects) if (bo && bo.subRole === subRole) num++;
    for (const bo of empire.builtObjects) if (bo && bo.subRole === subRole) num++;
    return num;
}

// DesignList.GetBuildableDesignsBySubRoles({ subRole }, empire) (sim/designGeneration.ts).
export function buildableDesignsBySubRole(empire: Empire, subRole: BuiltObjectSubRole): Design[] {
    return getBuildableDesignsBySubRoles(empire.designs, [subRole], empire);
}

/**
 * DesignDropDown.BindData: the row's designs sorted by Design.CompareTo (sub-role, then name); a row's list is the
 * buildable designs of that sub-role (not obsolete, empire.CanBuildDesign).
 */
export function buildOrderDesignOptions(empire: Empire, subRole: BuiltObjectSubRole): Design[] {
    return buildableDesignsBySubRole(empire, subRole)
        .slice()
        .sort((a, b) => (a.subRole !== b.subRole ? a.subRole - b.subRole : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** DesignDropDown.OnDrawItem text: "<sub-role> (<design name>)". */
export function buildOrderDesignLabel(design: Design): string {
    return `${resolveSubRoleDescription(design.subRole)} (${design.name})`;
}

/**
 * Main.Part2.cs 499-700 method_628: the advisor's target per sub-role. The state + private force-structure projections
 * (sorted, ForceStructureProjection.CompareTo) refactored to what the state money buys (RefactorForceStructure-
 * ProjectionsToCosts(list, includeCashflowCheck: false, …, randomizedOrder: false): no Rnd), plus the current state +
 * private force structure of that sub-role. Without state projections (the advisor has not planned yet) every target
 * is 0. Read-only.
 */
export function buildOrderAdvisorTargets(galaxy: Galaxy, empire: Empire): Map<BuiltObjectSubRole, number> {
    const out = new Map<BuiltObjectSubRole, number>();
    const date = galaxyStarDate(galaxy);
    const current = currentStateForceStructure(empire, date).projections.clone();
    const projected = new ForceStructureProjectionList();
    if (empire.stateForceStructureProjections !== null) {
        projected.addRange(empire.stateForceStructureProjections.clone());
        current.addRange(currentPrivateForceStructure(empire, date).projections);
        if (empire.privateForceStructureProjections !== null) projected.addRange(empire.privateForceStructureProjections.clone());
    }
    netSort(projected.items, (a, b) => a.compareTo(b));
    const refactored = refactorForceStructureProjectionsToCosts(galaxy, empire, projected, 0, 0, 0, false, false).result;
    for (const subRole of BUILD_ORDER_SUBROLES) {
        let n = 0;
        const p = refactored.getBySubRole(subRole);
        if (p !== null) {
            n = p.amount;
            const c = current.getBySubRole(subRole);
            if (c !== null) n += c.amount;
        }
        out.set(subRole, n);
    }
    return out;
}

/** method_629: the Advisor Suggest value, Math.Max(0, Math.Min(target, 1000) - current). */
export function advisorSuggestion(target: number, current: number): number {
    return Math.max(0, Math.min(target, 1000) - current);
}

export interface BuildOrderRow {
    subRole: BuiltObjectSubRole;
    type: string;
    current: number;
    /** Advisor Suggest (method_629 num2). */
    advisor: number;
    design: Design | null;
    /** The drop-down's designs (empty: a note is shown instead of the drop-down). */
    options: Design[];
    designText: string;
    unitCost: number;
    unitMaintenance: number;
}

// Main.Part2.cs:799 method_629 + :873 method_630 (design choice), :1113 method_641
// (unit cost) and :971 method_633 (unit maintenance, 0 for private sub-roles).
export function buildOrderRow(empire: Empire, galaxy: Galaxy, subRole: BuiltObjectSubRole, chosen: Design | null = null, advisorTarget = 0): BuildOrderRow {
    const current = shipsOfSubRoleCount(empire, subRole);
    const buildable = buildableDesignsBySubRole(empire, subRole);
    let design: Design | null = null;
    let designText: string;
    let options: Design[] = [];
    if (buildable.length > 0) {
        const s = buildable[0].subRole;
        if (
            empire.constructionYards.length <= 0 &&
            s !== BuiltObjectSubRole.ColonyShip &&
            s !== BuiltObjectSubRole.ConstructionShip &&
            s !== BuiltObjectSubRole.ResupplyShip
        ) {
            designText = `(${bt('No construction yards for this ship type')})`;
        } else {
            options = buildOrderDesignOptions(empire, subRole);
            // The drop-down's selection: the player's pick while it is still in the list, else the newest.
            design = chosen !== null && options.includes(chosen) ? chosen : findNewestCanBuild(empire.designs, subRole, empire);
            designText = design?.name ?? '';
        }
    } else {
        designText = `(${bt('No buildable designs')})`;
    }
    return {
        subRole,
        type: resolveSubRoleDescription(subRole),
        current,
        advisor: advisorSuggestion(advisorTarget, current),
        design,
        options,
        designText,
        unitCost: design ? design.calculateCurrentPurchasePrice(galaxy) : 0,
        unitMaintenance: design && !isPrivateBuildSubRole(subRole) ? designCalculateMaintenanceCosts(galaxy, design, empire) : 0,
    };
}

/** One row per BUILD_ORDER_SUBROLES entry (method_628). */
export function buildOrderRows(
    empire: Empire,
    galaxy: Galaxy,
    chosen: ReadonlyMap<BuiltObjectSubRole, Design> = new Map(),
    advisorTargets: ReadonlyMap<BuiltObjectSubRole, number> = new Map(),
): BuildOrderRow[] {
    return BUILD_ORDER_SUBROLES.map((s) => buildOrderRow(empire, galaxy, s, chosen.get(s) ?? null, advisorTargets.get(s) ?? 0));
}

// Main.Part2.cs:1043 method_637(…, "OrderAmount", 0, 1000, …): NumericUpDown Minimum 0, Maximum 1000.
export const ORDER_AMOUNT_MIN = 0;
export const ORDER_AMOUNT_MAX = 1000;

/** The Order Amount spinner's value: an integer clamped to [0, 1000] (non-numbers → 0). */
export function clampOrderAmount(v: unknown): number {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN;
    if (!Number.isFinite(n)) return ORDER_AMOUNT_MIN;
    return Math.min(ORDER_AMOUNT_MAX, Math.max(ORDER_AMOUNT_MIN, Math.trunc(n)));
}

// Empire.3.cs:3577 CheckEmpireHasOwnedColonies.
export function checkEmpireHasOwnedColonies(empire: Empire): boolean {
    for (const habitat of empire.colonies ?? []) if (habitat != null && habitat.owner === empire) return true;
    return false;
}

// Main.Part2.cs:840-846 (method_629): a pirate without a criminal network or owned colonies cannot order
// resupply / construction ships; :858-862: a row without a design (the Label) has its spinner at 0 and disabled.
export function orderAmountEnabled(empire: Empire, row: BuildOrderRow): boolean {
    if (row.design === null) return false;
    if (
        (row.subRole === BuiltObjectSubRole.ResupplyShip || row.subRole === BuiltObjectSubRole.ConstructionShip) &&
        empire.pirateEmpireBaseHabitat != null &&
        !checkPirateEmpireHasCriminalNetwork(empire) &&
        !checkEmpireHasOwnedColonies(empire)
    ) {
        return false;
    }
    return true;
}

/** method_628 bool_: the spinners start at the advisor's suggestion unless state construction is Manual. */
export function prefillFromAdvisor(empire: Empire): boolean {
    // AutomationLevel.Manual is value 0 (our AutomationLevel.Undefined, diplomacyTick MANUAL).
    return empire.controlStateConstruction !== AutomationLevel.Undefined;
}

/** method_629: a row's initial Order Amount (the advisor's suggestion when prefilling; 0 when the row is locked). */
export function initialOrderAmount(empire: Empire, row: BuildOrderRow): number {
    if (!orderAmountEnabled(empire, row)) return 0;
    return prefillFromAdvisor(empire) ? clampOrderAmount(row.advisor) : 0;
}

/** method_629 / method_634: the spinner is yellow and bold (font_7) while its value is above 0, else (170, 170, 170)
 *  regular (font_6). method_629 only highlights a prefilled advisor value; a spinner with a value is highlighted. */
export function orderAmountHighlighted(amount: number): boolean {
    return amount > 0;
}

export interface BuildOrderTotals {
    /** Per row: amount x unit purchase cost (method_633 `_<Type>Cost`). */
    rowCost: number[];
    /** Per row: amount x unit maintenance, 0 for private sub-roles (method_633 `_<Type>Maintenance`). */
    rowMaintenance: number[];
    /** method_632's return: the purchase total. */
    total: number;
    /** method_632's double_7: the annual maintenance total (state rows only). */
    maintenance: number;
}

// Main.Part2.cs:929 method_632 / :950 method_633 over the panel rows (amounts[i] is rows[i]'s spinner).
export function buildOrderTotals(galaxy: Galaxy, empire: Empire, rows: readonly BuildOrderRow[], amounts: readonly number[]): BuildOrderTotals {
    const n = rows.map((_, i) => clampOrderAmount(amounts[i] ?? 0));
    const { total, maintenance } = buildOrderTotalCost(galaxy, empire, rows.map((r) => r.design), n);
    return {
        rowCost: rows.map((r, i) => n[i] * r.unitCost),
        rowMaintenance: rows.map((r, i) => n[i] * r.unitMaintenance),
        total,
        maintenance,
    };
}

// Main.Part2.cs:911 method_631: enabled with "Purchase for X credits" (GameText) when the total is positive.
export function purchaseButtonState(total: number): { enabled: boolean; label: string } {
    return total > 0 ? { enabled: true, label: bt('Purchase for X credits', formatThousands(total)) } : { enabled: false, label: bt('Purchase') };
}

/** btnBuildOrderPurchase_Click 1138-1143: the "Cannot afford build order" message box when the total exceeds the
 *  state money (null: affordable). */
export function cannotAffordMessage(total: number, stateMoney: number): { caption: string; text: string } | null {
    if (!(total > stateMoney)) return null;
    return { caption: bt('Cannot afford build order'), text: bt('Build Order Purchase Cannot Afford', formatThousands(total), formatThousands(stateMoney)) };
}

// Main.Part2.cs:1136-1172 btnBuildOrderPurchase_Click's 16 method_643 calls (Escort … PassengerShip): the rows with a
// design and an amount > 0, in panel order.
export function buildOrderPurchaseLists(rows: readonly BuildOrderRow[], amounts: readonly number[]): { designs: Design[]; amounts: number[] } {
    const designs: Design[] = [];
    const out: number[] = [];
    for (const subRole of BUILD_ORDER_SUBROLES) {
        const i = rows.findIndex((r) => r.subRole === subRole);
        if (i < 0) continue;
        const num = clampOrderAmount(amounts[i] ?? 0);
        const design = rows[i].design;
        if (design !== null && num > 0) {
            designs.push(design);
            out.push(num);
        }
    }
    return { designs, amounts: out };
}

/** The toast text for a purchase result: the cannot-afford message box (caption + text) or the ships queued. */
export function purchaseResultText(result: BuildNewShipsResult): string {
    if (result.message !== undefined) {
        const title = result.title !== undefined ? resolveGameText(result.title) : '';
        const message = resolveGameText(result.message).replace(/\s*\n+\s*/g, ' ');
        return title ? `${title}: ${message}` : message;
    }
    const n = result.built.length;
    return `Build order placed: ${n} ${n === 1 ? 'ship' : 'ships'} queued for construction`;
}

// -------------------------------------------------------------------------------------------------------------------
// Layout (method_628, body-relative original pixels)
// -------------------------------------------------------------------------------------------------------------------

/** method_628: num = 27 (row pitch), num2 = 11 (the gap after Carrier, Resupply Ship and Construction Ship). */
export const BUILD_ORDER_ROW_PITCH = 27;
export const BUILD_ORDER_GROUP_GAP = 11;

/** pnlBuildOrder.Size(810, 605 + 11 + 27 × 6). */
export const BUILD_ORDER_SIZE = { w: 810, h: 605 + BUILD_ORDER_GROUP_GAP + BUILD_ORDER_ROW_PITCH * 6 } as const;

/** The column x's (int_ … int_7): Type, Current, Advisor, Order, Design, Cost, Maintenance, and their widths. */
export const BUILD_ORDER_COLUMNS = {
    type: { x: 10, w: 120 },
    current: { x: 140, w: 50 },
    advisor: { x: 200, w: 50 },
    order: { x: 260, w: 60 },
    design: { x: 330, w: 280 },
    cost: { x: 615, w: 70 },
    maintenance: { x: 695, w: 65 },
} as const;

/** pnlBuildOrderContainer: (0, 105), 760 × (300 + 11 + 27 × 6). */
export const BUILD_ORDER_CONTAINER = { x: 0, y: 105, w: 760, h: 300 + BUILD_ORDER_GROUP_GAP + BUILD_ORDER_ROW_PITCH * 6 } as const;

/** method_628 num29 = 420 + 11 + 27 × 6: the totals line; the money line at +30, the buttons at +67. */
export const BUILD_ORDER_TOTALS_Y = 420 + BUILD_ORDER_GROUP_GAP + BUILD_ORDER_ROW_PITCH * 6;

/** The y of each BUILD_ORDER_SUBROLES row inside the container (num5: += 27 per row, += 11 after Carrier, Resupply
 *  Ship and Construction Ship). */
export function buildOrderRowYs(): number[] {
    const ys: number[] = [];
    let y = 0;
    for (const s of BUILD_ORDER_SUBROLES) {
        ys.push(y);
        y += BUILD_ORDER_ROW_PITCH;
        if (s === BuiltObjectSubRole.Carrier || s === BuiltObjectSubRole.ResupplyShip || s === BuiltObjectSubRole.ConstructionShip) y += BUILD_ORDER_GROUP_GAP;
    }
    return ys;
}
