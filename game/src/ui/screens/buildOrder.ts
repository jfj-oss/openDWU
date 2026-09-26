// Build Order panel (task 16c, purchase follow-up): a port of the original's Build Order
// window, opened by F9 or the top-bar btnBuildOrder button. Rows follow
// Main.Part2.cs:404 method_628 (one per buildable sub-role), each row
// method_629 / method_630 (current amount, Order Amount spinner, newest buildable design),
// the row totals Main.Part2.cs:950 method_633 (amount x unit purchase cost :1113 method_641,
// amount x unit maintenance), the panel totals :929 method_632 / :911 method_631 and the
// Purchase button :1135 btnBuildOrderPurchase_Click → Empire.6.cs:3017 BuildNewShips.
// TODO(port): Advisor Suggest column — RefactorForceStructureProjectionsToCosts(randomizedOrder: false) over the state + private force-structure projections (Main.Part2.cs:509-560)
// TODO(port): Design drop-down per row — Main.Part2.cs:873 method_630 DesignDropDown (the row uses FindNewestCanBuild, the drop-down's initial selection)

import './buildOrder.css';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { Design } from '../../sim/design';
import { BuiltObjectSubRole } from '../../sim/builtObjectTypes';
import { findNewestCanBuild, getBuildableDesignsBySubRoles, resolveSubRoleDescription } from '../../sim/designGeneration';
import type { BuildNewShipsResult } from '../../sim/construction/empireConstruction';
import { buildNewShips, buildOrderTotalCost, designCalculateMaintenanceCosts } from '../../sim/construction/empireConstruction';
import { checkPirateEmpireHasCriminalNetwork } from '../../sim/missions/cmdTroops';
import { resolveGameText } from '../../sim/textResolver';
import { formatThousands } from '../../sim/diplomacyTick';
import { formatMoney } from '../hud';
import { showToast } from '../toast';

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

export interface BuildOrderRow {
    subRole: BuiltObjectSubRole;
    type: string;
    current: number;
    design: Design | null;
    designText: string;
    unitCost: number;
    unitMaintenance: number;
}

// Main.Part2.cs:799 method_629 + :873 method_630 (design choice), :1113 method_641
// (unit cost) and :971 method_633 (unit maintenance, 0 for private sub-roles).
export function buildOrderRow(empire: Empire, galaxy: Galaxy, subRole: BuiltObjectSubRole): BuildOrderRow {
    const current = shipsOfSubRoleCount(empire, subRole);
    const buildable = buildableDesignsBySubRole(empire, subRole);
    let design: Design | null = null;
    let designText: string;
    if (buildable.length > 0) {
        const s = buildable[0].subRole;
        if (
            empire.constructionYards.length <= 0 &&
            s !== BuiltObjectSubRole.ColonyShip &&
            s !== BuiltObjectSubRole.ConstructionShip &&
            s !== BuiltObjectSubRole.ResupplyShip
        ) {
            designText = '(No construction yards for this ship type)';
        } else {
            design = findNewestCanBuild(empire.designs, subRole, empire);
            designText = design?.name ?? '';
        }
    } else {
        designText = '(No buildable designs)';
    }
    return {
        subRole,
        type: resolveSubRoleDescription(subRole),
        current,
        design,
        designText,
        unitCost: design ? design.calculateCurrentPurchasePrice(galaxy) : 0,
        unitMaintenance: design && !isPrivateBuildSubRole(subRole) ? designCalculateMaintenanceCosts(galaxy, design, empire) : 0,
    };
}

/** One row per BUILD_ORDER_SUBROLES entry (method_628). */
export function buildOrderRows(empire: Empire, galaxy: Galaxy): BuildOrderRow[] {
    return BUILD_ORDER_SUBROLES.map((s) => buildOrderRow(empire, galaxy, s));
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
    return total > 0 ? { enabled: true, label: `Purchase for ${formatThousands(total)} credits` } : { enabled: false, label: 'Purchase' };
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

export interface BuildOrderOptions {
    /** The player's empire. */
    empire: Empire;
}

interface OpenState {
    root: HTMLElement;
    close: () => void;
}

let open: OpenState | null = null;

/** Open the Build Order panel, or close it if it is already open. */
export function toggleBuildOrder(opts: BuildOrderOptions): void {
    if (open) {
        open.close();
    } else {
        open = createBuildOrder(opts);
    }
}

/** Close the Build Order panel (no-op when closed). */
export function closeBuildOrder(): void {
    open?.close();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

function setText(e: HTMLElement, text: string, title = false): void {
    if (e.textContent !== text) e.textContent = text;
    if (title && e.title !== text) e.title = text;
}

function createBuildOrder(opts: BuildOrderOptions): OpenState {
    const galaxy: Galaxy = opts.empire.galaxy;

    const root = el('div', 'build-order-wrap');
    const win = el('div', 'build-order-window');
    const titlebar = el('div', 'build-order-titlebar');
    titlebar.appendChild(el('div', 'build-order-heading', 'Build Order'));
    const closeBtn = el('button', 'build-order-close', '✕');
    closeBtn.type = 'button';
    closeBtn.title = 'Close';
    titlebar.appendChild(closeBtn);
    win.appendChild(titlebar);

    const body = el('div', 'build-order-body');
    const money = el('div', 'build-order-money');
    body.appendChild(money);

    // Type | Current Amount | Order Amount | Design | Purchase Costs | Maint. Costs
    const header = el('div', 'build-order-header');
    for (const [text, num] of [['Type', false], ['Current Amount', true], ['Order Amount', true], ['Design', false], ['Purchase Costs', true], ['Maint. Costs', true]] as const) {
        header.appendChild(el('span', 'build-order-header-cell' + (num ? ' build-order-number' : ''), text));
    }
    body.appendChild(header);

    // Rows are created once (the sub-role list is fixed) and updated in place.
    const lines: HTMLElement[] = [];
    const inputs: HTMLInputElement[] = [];
    for (const subRole of BUILD_ORDER_SUBROLES) {
        // The private ships sit under their own spacer (Main.Part2.cs:741 num5 += num2).
        if (subRole === BuiltObjectSubRole.SmallFreighter) body.appendChild(el('div', 'build-order-separator'));
        const line = el('div', 'build-order-row');
        const input = el('input', 'build-order-amount');
        input.type = 'number';
        input.min = String(ORDER_AMOUNT_MIN);
        input.max = String(ORDER_AMOUNT_MAX);
        input.step = '1';
        input.value = '0';
        const amountCell = el('span', 'build-order-cell build-order-number');
        amountCell.appendChild(input);
        line.append(
            el('span', 'build-order-name'),
            el('span', 'build-order-cell build-order-number'),
            amountCell,
            el('span', 'build-order-cell'),
            el('span', 'build-order-cell build-order-number'),
            el('span', 'build-order-cell build-order-number'),
        );
        lines.push(line);
        inputs.push(input);
        body.appendChild(line);
    }

    // Main.Part2.cs:766 "TOTAL Purchase and Maintenance Costs" row (FfJsLkoYvX / lblBuildOrderTotalMaintenance).
    const totalLine = el('div', 'build-order-row build-order-total');
    const totalLabel = el('span', 'build-order-name', 'TOTAL Purchase and Maintenance Costs');
    const totalCost = el('span', 'build-order-cell build-order-number');
    const totalMaint = el('span', 'build-order-cell build-order-number');
    totalLine.append(totalLabel, totalCost, totalMaint);
    body.appendChild(totalLine);

    const footer = el('div', 'build-order-footer');
    const cancel = el('button', 'build-order-button', 'Cancel');
    cancel.type = 'button';
    const purchase = el('button', 'build-order-button build-order-purchase', 'Purchase');
    purchase.type = 'button';
    purchase.disabled = true;
    footer.append(cancel, purchase);
    body.appendChild(footer);

    win.appendChild(body);
    root.appendChild(win);
    document.body.appendChild(root);

    let rows: BuildOrderRow[] = [];

    function amounts(): number[] {
        return inputs.map((i) => clampOrderAmount(i.value));
    }

    // Main.Part2.cs:911 method_631 (totals + button) and :1003 method_634 (spinner highlight).
    function renderTotals(): void {
        const a = amounts();
        const t = buildOrderTotals(galaxy, opts.empire, rows, a);
        rows.forEach((_, i) => {
            const c = lines[i].children as HTMLCollectionOf<HTMLElement>;
            setText(c[4], formatThousands(t.rowCost[i]));
            setText(c[5], formatThousands(t.rowMaintenance[i]));
            inputs[i].classList.toggle('build-order-amount-set', a[i] > 0);
        });
        setText(totalCost, formatThousands(t.total));
        setText(totalMaint, formatThousands(t.maintenance));
        const b = purchaseButtonState(t.total);
        setText(purchase, b.label);
        purchase.disabled = !b.enabled;
    }

    function render(): void {
        setText(money, `Available money: ${formatMoney(opts.empire.stateMoney)}`);
        rows = buildOrderRows(opts.empire, galaxy);
        rows.forEach((r, i) => {
            const c = lines[i].children as HTMLCollectionOf<HTMLElement>;
            setText(c[0], r.type);
            setText(c[1], String(r.current));
            const enabled = orderAmountEnabled(opts.empire, r);
            if (!enabled && inputs[i].value !== '0') inputs[i].value = '0';
            inputs[i].disabled = !enabled;
            const tip = r.design ? `${r.designText} — unit cost ${formatThousands(r.unitCost)}, maintenance ${formatThousands(r.unitMaintenance)}` : r.designText;
            setText(c[3], r.designText);
            if (c[3].title !== tip) c[3].title = tip;
            c[3].classList.toggle('build-order-note', r.design === null);
        });
        renderTotals();
    }

    render();
    // Money, counts and prices change while open.
    const timer = window.setInterval(render, 2000);

    for (const input of inputs) {
        input.addEventListener('input', renderTotals);
        // Commit the spinner value (NumericUpDown clamps to [Minimum, Maximum] on leave).
        input.addEventListener('change', () => {
            const v = String(clampOrderAmount(input.value));
            if (input.value !== v) input.value = v;
            renderTotals();
        });
        // Main.Part2.cs:1024 method_635: select the value on Enter (focus).
        input.addEventListener('focus', () => input.select());
    }

    // Main.Part2.cs:1135 btnBuildOrderPurchase_Click.
    purchase.addEventListener('click', () => {
        rows = buildOrderRows(opts.empire, galaxy);
        const a = amounts();
        const lists = buildOrderPurchaseLists(rows, a);
        // The affordability check sums every row (method_632), which buildNewShips repeats over method_643's lists
        // (the same total: rows without a design or amount contribute 0).
        const result = buildNewShips(galaxy, opts.empire, lists.designs, lists.amounts);
        if (result.message !== undefined) {
            // MessageBoxEx "Cannot afford build order": the panel stays open.
            showToast(purchaseResultText(result), root, 6000);
            render();
            return;
        }
        // method_639: close the panel.
        close();
        showToast(purchaseResultText(result));
    });

    function close(): void {
        window.clearInterval(timer);
        document.removeEventListener('keydown', onKeyDown);
        root.remove();
        open = null;
    }

    // Escape closes the panel; stopImmediatePropagation keeps the global game-menu Escape handler from firing.
    function onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            close();
        }
    }
    document.addEventListener('keydown', onKeyDown);
    closeBtn.addEventListener('click', () => close());
    // Main.Part2.cs:1179 btnBuildOrderCancel_Click → method_639.
    cancel.addEventListener('click', () => close());

    return { root, close };
}
