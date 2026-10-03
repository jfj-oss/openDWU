// Build Order screen: a 1:1 port of the original's pnlBuildOrder (the "purchase new ships" screen), opened by the top
// bar's btnBuildOrder (buildButton.png, Main.Part2.cs 1196 btnBuildOrder_Click → 404 method_628), F9, or an advisor
// BuildOrder suggestion. Built on the shared original-style window (originalWindow.ts): the ScreenPanel is 810 × 778,
// every control at the Location / Size method_628 / method_629 give it (body-relative original pixels).
//
// Rows (method_629): Type label (font_7) · Current Amount · Advisor Suggest · Order Amount (NumericUpDown 0..1000,
// prefilled with the advisor's suggestion unless state construction is Manual; yellow bold while above 0) · Design
// (DesignDropDown: flag + small ship picture + "<role> (<name>)", initially FindNewestCanBuild; or the "(No buildable
// designs)" / "(No construction yards for this ship type)" note) · Purchase Costs (font_7) · Maint. Costs (font_6).
// The private ship types sit below the state ones (no maintenance). Totals (yellow), the available money / cashflow,
// Cancel and "Purchase for X credits" → Empire.6.cs 3017 BuildNewShips via the player command log.
//
// Extras kept from our earlier panel: the design tooltip (size, unit cost, maintenance), a toast with the result,
// live refresh of the counts / money / design lists while open.

import './buildOrder.css';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { Design } from '../../sim/design';
import { BuiltObjectSubRole } from '../../sim/builtObjectTypes';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { moneyPanelIncome } from '../../sim/treasury';
import { formatThousands } from '../../sim/diplomacyTick';
import { builtObjectImageUrl, resolveDrawPictureRef } from '../../render/builtObjectLayer';
import { empireFlagUrl } from '../selectionInfoView';
import { showToast } from '../toast';
import {
    COLORS,
    FONT,
    el,
    glassButton,
    imageCombo,
    messageBox,
    numericUpDown,
    openOriginalWindow,
    place,
    setButtonLabel,
    setText,
    text,
    type ImageCombo,
    type ImageComboItem,
    type NumericUpDown,
    type OriginalWindow,
} from '../originalWindow';
import {
    BUILD_ORDER_COLUMNS as C,
    BUILD_ORDER_CONTAINER,
    BUILD_ORDER_SIZE,
    BUILD_ORDER_SUBROLES,
    BUILD_ORDER_TOTALS_Y,
    ORDER_AMOUNT_MAX,
    ORDER_AMOUNT_MIN,
    bt,
    buildOrderAdvisorTargets,
    buildOrderDesignLabel,
    buildOrderPurchaseLists,
    buildOrderRowYs,
    buildOrderRows,
    buildOrderTotals,
    cannotAffordMessage,
    initialOrderAmount,
    orderAmountEnabled,
    orderAmountHighlighted,
    purchaseButtonState,
    purchaseResultText,
    type BuildOrderRow,
} from './buildOrderModel';

export * from './buildOrderModel';

export interface BuildOrderOptions {
    /** The player's empire. */
    empire: Empire;
}

let open: OriginalWindow | null = null;

/** Open the Build Order screen, or close it if it is already open (btnBuildOrder_Click). */
export function toggleBuildOrder(opts: BuildOrderOptions): void {
    if (open && !open.closed) open.close();
    else open = createBuildOrder(opts);
}

/** Close the Build Order screen (no-op when closed). */
export function closeBuildOrder(): void {
    open?.close();
}

/** Labels (method_636): (170, 170, 170) on transparent, 23 px high, text aligned in the box. */
function label(content: string, x: number, y: number, w: number, align: 'left' | 'center' | 'right', bold: boolean, size: number = FONT.large): HTMLDivElement {
    const t = text(content, { size, bold, color: COLORS.label, shadow: false, className: `bo-cell bo-${align}` });
    return place(t, x, y, w, 23);
}

/** Small ship picture of a design (BuiltObjectImageCache small images: Rotate90FlipNone). */
function designShipUrl(d: Design): string | null {
    return builtObjectImageUrl(resolveDrawPictureRef({ pictureRef: d.pictureRef, isPlanetDestroyer: false, subRole: d.subRole, builtObjectID: 0 }));
}

function createBuildOrder(opts: BuildOrderOptions): OriginalWindow {
    const empire = opts.empire;
    const galaxy: Galaxy = empire.galaxy;
    let timer = 0;
    const win = openOriginalWindow({
        id: 'buildorder',
        title: bt('Build Order'),
        icon: 'buildButton.png',
        width: BUILD_ORDER_SIZE.w,
        height: BUILD_ORDER_SIZE.h,
        onClose: () => {
            window.clearInterval(timer);
            for (const c of combos) c?.close();
            if (open === win) open = null;
        },
    });
    const body = win.body;
    body.classList.add('bo-body');

    // lblBuildOrderExplanation (10, 10), font_6, MaximumSize 720 × 35.
    const expl = text(bt('Build Order Explanation'), { size: FONT.large, color: COLORS.label, shadow: false, wrapWidth: 720, className: 'bo-explanation' });
    body.appendChild(place(expl, 10, 10));

    // Column headers at y 60 (font_3 bold): AutoSize labels with a MaximumSize (wrapping, centred) for the three
    // amount columns; 40 px high boxes for Design (left), Purchase Costs and Maint. Costs (right).
    const head = (s: string, x: number, maxW: number): void => {
        const t = text(s, { size: FONT.normal, bold: true, color: COLORS.label, shadow: false, className: 'bo-head-auto' });
        t.style.maxWidth = `${maxW}px`;
        body.appendChild(place(t, x, 60));
    };
    head(bt('Current Amount'), C.current.x, 60);
    head(bt('Advisor Suggest'), C.advisor.x, 60);
    head(bt('Order Amount'), C.order.x, 70);
    const headBox = (s: string, x: number, w: number, align: 'left' | 'right'): void => {
        const t = text(s, { size: FONT.normal, bold: true, color: COLORS.label, shadow: false, className: `bo-head-box bo-${align}` });
        body.appendChild(place(t, x, 60, w, 40));
    };
    headBox(bt('Design'), C.design.x, C.design.w, 'left');
    headBox(bt('Purchase Costs'), C.cost.x + 5, 70, 'right');
    headBox(bt('Maintenance Costs Abbreviated'), C.maintenance.x + 5, 65, 'right');

    // pnlBuildOrderContainer and its rows.
    const container = place(el('div', 'bo-container'), BUILD_ORDER_CONTAINER.x, BUILD_ORDER_CONTAINER.y, BUILD_ORDER_CONTAINER.w, BUILD_ORDER_CONTAINER.h);
    body.appendChild(container);

    const advisorTargets = buildOrderAdvisorTargets(galaxy, empire);
    const chosen = new Map<BuiltObjectSubRole, Design>();
    let rows: BuildOrderRow[] = buildOrderRows(empire, galaxy, chosen, advisorTargets);
    const ys = buildOrderRowYs();

    interface RowView {
        current: HTMLDivElement;
        advisor: HTMLDivElement;
        spin: NumericUpDown;
        designCell: HTMLDivElement;
        cost: HTMLDivElement;
        maintenance: HTMLDivElement;
    }
    const views: RowView[] = [];
    const combos: (ImageCombo | null)[] = BUILD_ORDER_SUBROLES.map(() => null);
    const comboKeys: string[] = BUILD_ORDER_SUBROLES.map(() => '');

    rows.forEach((r, i) => {
        const y = ys[i];
        container.appendChild(label(r.type, C.type.x, y, C.type.w, 'left', true));
        const current = container.appendChild(label(String(r.current), C.current.x, y, C.current.w, 'center', false));
        const advisor = container.appendChild(label(String(r.advisor), C.advisor.x, y, C.advisor.w, 'center', false));
        const spin = numericUpDown({ value: initialOrderAmount(empire, r), min: ORDER_AMOUNT_MIN, max: ORDER_AMOUNT_MAX, size: FONT.large, onChange: () => renderTotals() });
        container.appendChild(place(spin.el, C.order.x, y, C.order.w, 23));
        const designCell = container.appendChild(place(el('div', 'bo-design'), C.design.x, y - 1, C.design.w, 25));
        const cost = container.appendChild(label('0', C.cost.x, y, C.cost.w, 'right', true));
        const maintenance = container.appendChild(label('0', C.maintenance.x, y, C.maintenance.w, 'right', false));
        views.push({ current, advisor, spin, designCell, cost, maintenance });
    });

    // Totals (num29), money line (+30) and the buttons (+67).
    const ty = BUILD_ORDER_TOTALS_Y;
    body.appendChild(place(text(bt('TOTAL Purchase and Maintenance Costs'), { size: FONT.large, bold: true, color: COLORS.label, shadow: false }), 357, ty));
    const totalCost = body.appendChild(label('0', C.cost.x - 5, ty + 4, C.cost.w + 5, 'right', true));
    totalCost.style.color = 'rgb(255, 255, 0)';
    const totalMaint = body.appendChild(label('0', C.maintenance.x, ty + 4, C.maintenance.w, 'right', false));
    totalMaint.style.color = 'rgb(255, 255, 0)';
    body.appendChild(place(text(bt('Available Money and Cashflow'), { size: FONT.large, bold: true, color: COLORS.label, shadow: false }), 414, ty + 30));
    const funds = body.appendChild(label('', C.cost.x - 5, ty + 34, C.cost.w + 5, 'right', true));
    const cashflow = body.appendChild(label('', C.maintenance.x, ty + 34, C.maintenance.w, 'right', false));

    const cancel = glassButton(bt('Cancel'), { size: 15.83, onClick: () => win.close() });
    body.appendChild(place(cancel, 12, ty + 67, 238, 40));
    const purchase = glassButton(bt('Purchase'), { size: 15.83, disabled: true, onClick: () => void onPurchase() });
    body.appendChild(place(purchase, 260, ty + 67, 520, 40));

    /** The design cell: a DesignDropDown for a row with designs, else the note label; rebuilt only when the list changes. */
    function renderDesignCell(i: number, r: BuildOrderRow): void {
        const cell = views[i].designCell;
        if (r.options.length === 0 || r.design === null) {
            if (combos[i] !== null || cell.childElementCount === 0) {
                combos[i]?.close();
                combos[i] = null;
                comboKeys[i] = '';
                cell.replaceChildren(place(text(r.designText, { size: FONT.large, color: COLORS.label, shadow: false, className: 'bo-cell bo-center' }), 0, 1, C.design.w, 23));
            }
            return;
        }
        const key = r.options.map((d) => `${d.name}|${d.pictureRef}`).join('\u0001');
        if (combos[i] === null || comboKeys[i] !== key) {
            combos[i]?.close();
            const flag = empireFlagUrl(galaxy, empire).catch(() => null);
            const items: ImageComboItem[] = r.options.map((d, k) => ({
                value: String(k),
                label: buildOrderDesignLabel(d),
                // OnDrawItem: the design empire's flag at x 3, the small ship picture at x 30, the text at x 49.
                pictures: [
                    { url: flag, x: 3 },
                    { url: designShipUrl(d), x: 30, square: true, rotate: 90 },
                ],
                title: `${d.name}: size ${d.size}, cost ${formatThousands(d.calculateCurrentPurchasePrice(galaxy))}`,
            }));
            const combo = imageCombo({
                items,
                value: String(r.options.indexOf(r.design)),
                textX: 49,
                size: FONT.large,
                maxItems: 10,
                onChange: (v) => {
                    const pick = rows[i].options[Number(v)];
                    if (pick !== undefined) chosen.set(rows[i].subRole, pick);
                    refresh();
                },
            });
            // DesignDropDown.Size(250, …), then the control sized to int_77 = 280.
            cell.replaceChildren(place(combo.el, 0, 0, C.design.w, 25));
            combos[i] = combo;
            comboKeys[i] = key;
        }
        combos[i]!.setValue(String(r.options.indexOf(r.design)));
        const c = combos[i]!.el;
        c.title = `${r.design.name}: size ${r.design.size} — unit cost ${formatThousands(r.unitCost)}, maintenance ${formatThousands(r.unitMaintenance)}`;
    }

    const amounts = (): number[] => views.map((v) => v.spin.value);

    // method_631 (totals + button) and method_634 (spinner colours).
    function renderTotals(): void {
        const a = amounts();
        const t = buildOrderTotals(galaxy, empire, rows, a);
        rows.forEach((_, i) => {
            setText(views[i].cost, formatThousands(t.rowCost[i]));
            setText(views[i].maintenance, formatThousands(t.rowMaintenance[i]));
            const hot = orderAmountHighlighted(a[i]);
            views[i].spin.setStyle(hot ? 'rgb(255, 255, 0)' : COLORS.label, hot);
        });
        setText(totalCost, formatThousands(t.total));
        setText(totalMaint, formatThousands(t.maintenance));
        const b = purchaseButtonState(t.total);
        setButtonLabel(purchase, b.label);
        purchase.disabled = !b.enabled;
    }

    function refresh(): void {
        rows = buildOrderRows(empire, galaxy, chosen, advisorTargets);
        rows.forEach((r, i) => {
            setText(views[i].current, String(r.current));
            const enabled = orderAmountEnabled(empire, r);
            if (!enabled && views[i].spin.value !== 0) views[i].spin.setValue(0);
            views[i].spin.setEnabled(enabled);
            renderDesignCell(i, r);
        });
        setText(funds, formatThousands(empire.stateMoney));
        const income = moneyPanelIncome(galaxy, empire);
        if (income !== null) setText(cashflow, formatThousands(income.cashflow));
        renderTotals();
    }

    // btnBuildOrderPurchase_Click: the cannot-afford message box, else BuildNewShips and close (method_639).
    async function onPurchase(): Promise<void> {
        rows = buildOrderRows(empire, galaxy, chosen, advisorTargets);
        const a = amounts();
        const t = buildOrderTotals(galaxy, empire, rows, a);
        const no = cannotAffordMessage(t.total, empire.stateMoney);
        if (no !== null) {
            await messageBox({ caption: no.caption, text: no.text, icon: 'stop' });
            return;
        }
        const lists = buildOrderPurchaseLists(rows, a);
        // Command log: queued, applied at the next frame boundary (BuildNewShips repeats the affordability check).
        issuePlayerCommand(galaxy, empire, 'buildNewShips', [lists.designs, lists.amounts], (result) => {
            if (result.message !== undefined) {
                void messageBox({ caption: result.title !== undefined ? bt('Cannot afford build order') : '', text: purchaseResultText(result), icon: 'stop' });
                if (!win.closed) refresh();
                return;
            }
            showToast(purchaseResultText(result));
        });
        win.close();
    }

    refresh();
    // Money, counts and prices change while open.
    timer = window.setInterval(() => {
        if (!win.closed) refresh();
    }, 2000);
    return win;
}
