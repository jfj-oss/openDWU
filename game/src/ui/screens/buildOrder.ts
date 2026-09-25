// Build Order panel (task 16c): a read-only port of the original's Build Order
// window, opened by F9 or the top-bar btnBuildOrder button. Rows follow
// Main.Part2.cs:404 method_628 (one per buildable sub-role), each row
// method_629 / method_630 (current amount, newest buildable design), the unit
// purchase cost Main.Part2.cs:1113 method_641 and the unit maintenance
// Main.Part2.cs:971 method_633. The Purchase button (Main.Part2.cs:1135
// btnBuildOrderPurchase_Click) is shown disabled.
// TODO(port): Purchase — Empire.6.cs:3017 BuildNewShips(designs, amounts) is not ported to src/sim/ (it draws Galaxy.Rnd via GenerateBuiltObjectName + AddBuiltObjectToGalaxy, picks yards with FindShortestConstructionWaitQueue, procures components and charges StateMoney). Port it into src/sim/construction/empireConstruction.ts, then add Order Amount inputs and enable the button (Main.Part2.cs:1135)
// TODO(port): Advisor Suggest column — RefactorForceStructureProjectionsToCosts(randomizedOrder: false) over the state + private force-structure projections (Main.Part2.cs:509-560)

import './buildOrder.css';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { Design } from '../../sim/design';
import { BuiltObjectSubRole } from '../../sim/builtObjectTypes';
import { canBuildDesign, findNewestCanBuild, resolveSubRoleDescription } from '../../sim/designGeneration';
import { designCalculateMaintenanceCosts } from '../../sim/construction/empireConstruction';
import { formatMoney } from '../hud';

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

// DesignList.GetBuildableDesignsBySubRoles({ subRole }, empire): !IsObsolete && empire.CanBuildDesign(design).
export function buildableDesignsBySubRole(empire: Empire, subRole: BuiltObjectSubRole): Design[] {
    return empire.designs.filter((d) => d.subRole === subRole && !d.isObsolete && canBuildDesign(empire, d));
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

    // Type | Current Amount | Design | Purchase Costs | Maint. Costs
    const header = el('div', 'build-order-header');
    for (const [text, num] of [['Type', false], ['Current Amount', true], ['Design', false], ['Purchase Costs', true], ['Maint. Costs', true]] as const) {
        header.appendChild(el('span', 'build-order-header-cell' + (num ? ' build-order-number' : ''), text));
    }
    body.appendChild(header);

    // Rows are created once (the sub-role list is fixed) and updated in place.
    const lines: HTMLElement[] = [];
    for (const subRole of BUILD_ORDER_SUBROLES) {
        // The private ships sit under their own spacer (Main.Part2.cs:741 num5 += num2).
        if (subRole === BuiltObjectSubRole.SmallFreighter) body.appendChild(el('div', 'build-order-separator'));
        const line = el('div', 'build-order-row');
        line.append(
            el('span', 'build-order-name'),
            el('span', 'build-order-cell build-order-number'),
            el('span', 'build-order-cell'),
            el('span', 'build-order-cell build-order-number'),
            el('span', 'build-order-cell build-order-number'),
        );
        lines.push(line);
        body.appendChild(line);
    }

    const footer = el('div', 'build-order-footer');
    const purchase = el('button', 'build-order-button', 'Purchase');
    purchase.type = 'button';
    purchase.disabled = true;
    purchase.title = 'not yet available';
    footer.appendChild(purchase);
    body.appendChild(footer);

    win.appendChild(body);
    root.appendChild(win);
    document.body.appendChild(root);

    function render(): void {
        setText(money, `Available money: ${formatMoney(opts.empire.stateMoney)}`);
        const rows = buildOrderRows(opts.empire, galaxy);
        rows.forEach((r, i) => {
            const c = lines[i].children as HTMLCollectionOf<HTMLElement>;
            setText(c[0], r.type);
            setText(c[1], String(r.current));
            setText(c[2], r.designText, true);
            c[2].classList.toggle('build-order-note', r.design === null);
            setText(c[3], formatMoney(r.unitCost));
            setText(c[4], formatMoney(r.unitMaintenance));
        });
    }

    render();
    // Money and counts change while open.
    const timer = window.setInterval(render, 2000);

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

    return { root, close };
}
