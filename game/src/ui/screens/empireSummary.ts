// Empire Summary screen (F6 / the top bar's flag button): a port of the original pnlEmpireSummary ScreenPanel on the
// shared original-style window (../originalWindow.ts).
// Sources:
// - DistantWorlds/Main.Part9.cs:4180 method_274 (window 1027 × 770, title "Empire Summary: NAME" with the player's
//   LargeFlagPicture as the header icon; the name box at (120, 10), "Set Empire Policy & Automation" at (700, 10),
//   pnlEmpireSummaryColony at (10, 40) 420 × 300, the government link (271, 164) / combo (271, 189), the revolution
//   button (10, 345) 420 × 50, pnlEmpireSummaryEconomy at (450, 54) 550 × 340, pnlEmpireSummaryBonus at (10, 412)
//   350 × 282, pnlEmpireSummaryBuiltObject at (368, 412) 632 × 282), method_275 (close: also closes Empire Policy);
//   Main.Part4.cs cmbEmpireSummaryChangeGovernmentType_SelectedIndexChanged, lnkEmpireSummaryGovernmentType_LinkClicked;
//   Main.Part6.cs btnEmpireSummaryChangeGovernment_Click; Main.InitializeComponent.cs (panel colours / borders);
// - DistantWorlds/Controls/EmpireSummaryColony.cs, EmpireSummaryEconomy.cs, EmpireSummaryBonusesTitle.cs +
//   EmpireSummaryBonuses.cs, EmpireSummaryBuiltObject.cs (their OnPaint layouts, drawn here as positioned labels).
// The figures come from empireSummaryModel.ts (pure) and sim/economyBreakdown.ts (the Economy block, read-only).
// Our additions (kept from the streamlined screen): the [freightOverlay] "Where does the money go?" link to the Trade
// Flows panel, and the mod-layer rows ([emergent] / [security] stability, [court], scenario crises) listed under the
// bonuses in the Bonuses panel's scroll area.
// The name box (txtEmpireSummaryName_Leave) and the revolution button (Empire.HaveRevolution) issue the journaled player
// commands 'empireRename' / 'empireChangeGovernment' (sim/player/playerOps.ts → playerOrders.ts).

import './empireSummary.css';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { Habitat } from '../../sim/types';
import { getGovernmentsStatic } from '../../sim/empire';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { BuiltObjectSubRole } from '../../sim/builtObjectTypes';
import { annualStateMaintenance, annualTaxRevenue } from '../../sim/forceStructure';
import { computeEconomyBreakdown, type EconomyBreakdown, type EconomyLine } from '../../sim/economyBreakdown';
import type { PirateEconomyYear } from '../../sim/pirates/pirateEconomy';
import { formatThousandsK } from './coloniesList';
import { formatMoney, formatPopulation } from '../hud';
import { crisesSummaryRows } from '../../sim/scenario/emergent/crisesCore';
import { stabilityRow } from '../emergentPolitics'; // [emergent]
import { ledgerStabilityRow } from '../internalSecurityView'; // [security]
import { courtSummaryRows } from '../courtView'; // [court]
import {
    COLORS,
    FONT,
    chromeImageUrl,
    dropDown,
    el,
    glassButton,
    gradientPanel,
    linkLabel,
    openOriginalWindow,
    place,
    scrollPanel,
    setButtonLabel,
    text,
    textBox,
    messageBox,
    type OriginalWindow,
    type TextOptions,
} from '../originalWindow';
import { empireFlagUrl } from '../selectionInfoView';
import { racePortraitUrl } from '../empireEmblem';
import { facilityImageUrl } from './researchTreeModel';
import { characterPortrait } from '../characterPortrait';
import { openGalactopedia } from './galactopedia';
import { isEmpirePolicyOpen, toggleEmpirePolicy, closeEmpirePolicy } from './empirePolicy';
import { formatK, gt } from './researchBenefits';
import {
    SHIP_COLUMNS,
    abilityBonusLines,
    SUMMARY_COLORS,
    bonusLines,
    colonyStatRows,
    format0,
    formatFirepower,
    governmentRows,
    negativeColor,
    percent0,
    piratePlayStyleDescription,
    pirateModifierLines,
    revolutionButtonState,
    shipRoleStats,
    shipRowLabel,
    type BonusLine,
} from './empireSummaryModel';
import { requestSimRefresh } from '../../simworker/refresh';
import { openResourceSupply, resourceSupplyAvailable } from './resourceSupply'; // [improvements] supplyChain
import { supplySnapshot } from '../supplyChainCache'; // [improvements] supplyChain

/** The data the panel displays: the player's empire plus its government's
 * display name (null when unknown). */
export interface EmpireSummarySource {
    empire: Empire;
    governmentName: string | null;
}

/** One displayed row of the streamlined summary (kept for the mod-layer rows and the tests). */
export interface EmpireSummaryRow {
    label: string;
    value: string;
    /** Tooltip (19m: the stability ledger's causes). */
    title?: string;
}

/** The extra Economy rows (task 13b, EmpireSummaryEconomy.cs 343-381): the
 * leader's name and the empire's annual tax revenue / state maintenance
 * (null when the sim throws TODO(port)), plus counts of space ports, mining
 * stations, state & private ships/bases and characters. */
export interface EmpireSummaryExtra {
    leaderName: string | null;
    taxRevenue: number | null;
    maintenance: number | null;
    stateShipsAndBases: number;
    privateShipsAndBases: number;
    spacePorts: number;
    miningStations: number;
    characters: number;
}

/** Impure wrapper reading the extra fields off the empire. Each sim call is
 * in its own try/catch (some paths still throw TODO(port)) and falls back to
 * null; array lengths use `?.length ?? 0`. */
export function empireSummaryExtra(e: Empire): EmpireSummaryExtra {
    let taxRevenue: number | null = null;
    try {
        taxRevenue = annualTaxRevenue(e.galaxy, e);
    } catch {
        taxRevenue = null;
    }
    let maintenance: number | null = null;
    try {
        maintenance = annualStateMaintenance(e);
    } catch {
        maintenance = null;
    }
    return {
        leaderName: e.leader?.name ?? null,
        taxRevenue,
        maintenance,
        stateShipsAndBases: e.builtObjects?.length ?? 0,
        privateShipsAndBases: e.privateBuiltObjects?.length ?? 0,
        spacePorts: e.spacePorts?.length ?? 0,
        miningStations: e.miningStations?.length ?? 0,
        characters: e.characters?.length ?? 0,
    };
}

/** The streamlined summary's rows: Empire, Race, Government, Capital, Colonies, Population, Treasury; with an `extra`,
 * the Economy rows (Leader, Colony tax revenue, Ship & base maintenance, Space ports, Mining stations, State ships &
 * bases, Private ships & bases, Characters); then the scenario rows. Missing values show '—'. */
export function empireSummaryRows(
    src: EmpireSummarySource,
    extra?: EmpireSummaryExtra,
    scenarioRows?: readonly EmpireSummaryRow[],
): EmpireSummaryRow[] {
    const e = src.empire;
    let population = 0;
    for (const c of e.colonies) {
        population += c.population?.totalAmount ?? 0;
    }
    const rows: EmpireSummaryRow[] = [
        { label: 'Empire', value: e.name },
        { label: 'Race', value: e.dominantRace?.name ?? '—' },
        { label: 'Government', value: src.governmentName ?? '—' },
        { label: 'Capital', value: e.capital?.name ?? '—' },
        { label: 'Colonies', value: String(e.colonies.length) },
        { label: 'Population', value: formatPopulation(population) },
        { label: 'Treasury', value: formatMoney(e.stateMoney) },
    ];
    if (extra) {
        rows.push(
            { label: 'Leader', value: extra.leaderName ?? '—' },
            { label: 'Colony tax revenue', value: extra.taxRevenue == null ? '—' : formatThousandsK(extra.taxRevenue) },
            { label: 'Ship & base maintenance', value: extra.maintenance == null ? '—' : formatThousandsK(extra.maintenance) },
            { label: 'Space ports', value: String(extra.spacePorts) },
            { label: 'Mining stations', value: String(extra.miningStations) },
            { label: 'State ships & bases', value: String(extra.stateShipsAndBases) },
            { label: 'Private ships & bases', value: String(extra.privateShipsAndBases) },
            { label: 'Characters', value: String(extra.characters) },
        );
    }
    // Mod layer: scenario blocks (19d2 "Crises") after the stock rows.
    if (scenarioRows) rows.push(...scenarioRows);
    return rows;
}

/** Text rows of the Economy block (EmpireSummaryEconomy.cs method_6) as a list: section headings and label/value lines. */
export function economyBlockRows(b: EconomyBreakdown): { heading?: string; label?: string; value?: string; negative?: boolean }[] {
    const line = (l: EconomyLine, expense = false) => ({ label: l.label, value: formatThousandsK(l.value), negative: expense && l.value > 0 });
    const cf = (v: number) => ({ label: 'Cashflow', value: formatThousandsK(v), negative: v < 0 });
    return [
        { heading: 'Economy — State' },
        { label: 'Cash on hand', value: formatThousandsK(b.state.cashOnHand), negative: b.state.cashOnHand < 0 },
        { heading: 'Annual Income' },
        ...b.state.income.map((l) => line(l)),
        { heading: 'Annual Expenses' },
        ...b.state.expenses.map((l) => line(l, true)),
        cf(b.state.cashflow),
        { heading: "This Year's Bonus Income" },
        ...b.state.bonusIncome.map((l) => line(l)),
        { heading: 'Economy — Private' },
        { label: 'Cash on hand', value: formatThousandsK(b.private.cashOnHand), negative: b.private.cashOnHand < 0 },
        { heading: 'Annual Income' },
        ...b.private.income.map((l) => line(l)),
        { heading: 'Annual Expenses' },
        ...b.private.expenses.map((l) => line(l, true)),
        cf(b.private.cashflow),
    ];
}

/** The mod-layer rows shown under the bonuses: scenario crises, [emergent] / [security] stability, [court]. */
export function modLayerSummaryRows(galaxy: Galaxy | null | undefined, empire: Empire): EmpireSummaryRow[] {
    if (!galaxy) return [];
    const rows: EmpireSummaryRow[] = galaxy.scenario ? [...crisesSummaryRows(galaxy, empire)] : [];
    // [emergent] begin — 19d1 internal politics: instability as a Stability row (flag on only)
    const stability = stabilityRow(galaxy, empire);
    // [security] 19m: the Stability row comes from the ledger and lists its causes (19d1 instability kept in the value).
    const ledger = ledgerStabilityRow(galaxy, empire);
    if (ledger !== null) rows.push(stability !== null ? { ...ledger, value: `${stability.value} · ${ledger.value}` } : ledger);
    else if (stability !== null) rows.push(stability);
    // [emergent] end
    rows.push(...courtSummaryRows(galaxy, empire)); // [court] 19n legitimacy, house, succession, council
    return rows;
}

// -------------------------------------------------------------------------------------------------------------------
// Screen state and entry points
// -------------------------------------------------------------------------------------------------------------------

interface OpenState {
    win: OriginalWindow;
    close: () => void;
}

let open: OpenState | null = null;
let source: (() => EmpireSummarySource | null) | null = null;

/** Register the callback that supplies the panel's data (the HUD wires it to
 * the player's empire), or null to detach. */
export function setEmpireSummarySource(get: (() => EmpireSummarySource | null) | null): void {
    source = get;
}

/** The registered source's current value, or null when nothing is registered
 * or the callback returns null (task 12m: the Colonies list reads the player
 * empire through this). */
export function getEmpireSummarySource(): EmpireSummarySource | null {
    return source?.() ?? null;
}

/** Open the Empire Summary screen, or close it if it is already open. A no-op
 * when no source is registered (e.g. the generateGalaxy-only boot path). */
export function toggleEmpireSummary(): void {
    if (open) {
        open.close();
    } else if (source && typeof document !== 'undefined') {
        const s = source();
        if (s) open = createEmpireSummary(s);
    }
}

/** True while the screen is open. */
export function isEmpireSummaryOpen(): boolean {
    return open !== null;
}

// [improvements] supplyChain: the resource the empire's construction lacks most (nothing coming first), for the link.
function mostNeededResource(galaxy: Galaxy, empire: Empire): number {
    const snap = supplySnapshot(galaxy, empire);
    let best = -1;
    let bestScore = 0;
    const score = new Map<number, number>();
    for (const s of snap?.sites ?? []) for (const r of s.resources) score.set(r.resourceId, (score.get(r.resourceId) ?? 0) + r.missing + 10 * r.uncovered);
    for (const [id, v] of score) if (v > bestScore) [best, bestScore] = [id, v];
    if (best >= 0) return best;
    const first = [...galaxy.resourceSystem.resources].sort((a, b) => (a.name < b.name ? -1 : 1))[0];
    return first?.resourceId ?? 0;
}

// [freightOverlay] begin — task 19e-9: "Where does the money go?" link to the Trade Flows panel (main.ts wires it).
let openTradeFlowsLink: (() => void) | null = null;
export function setEmpireSummaryTradeFlowsLink(fn: (() => void) | null): void {
    openTradeFlowsLink = fn;
}
// [freightOverlay] end

/** Close the Empire Summary screen (no-op when closed). */
export function closeEmpireSummary(): void {
    open?.close();
}

// -------------------------------------------------------------------------------------------------------------------
// Drawing helpers (the controls' DrawString calls)
// -------------------------------------------------------------------------------------------------------------------

/** Font (16.67 px), font_0 (bold) and font_1 (Font.Size + 3, bold) of the summary controls (SetFont(16.67f)). */
const F = { normal: FONT.large, title: FONT.large + 3 } as const;

/** A drop-shadowed label at (x, y): `align` 'right' ends it at x (method_1), 'center' centres it on x (method_0). */
function lbl(parent: HTMLElement, content: string, x: number, y: number, o: TextOptions & { align?: 'left' | 'right' | 'center' } = {}): HTMLDivElement {
    const t = text(content, { size: F.normal, color: SUMMARY_COLORS.text, ...o });
    if (o.align === 'right') t.classList.add('ow-right');
    else if (o.align === 'center') t.classList.add('ow-center');
    parent.appendChild(place(t, x, y));
    return t;
}

const bold = (o: TextOptions & { align?: 'left' | 'right' | 'center' } = {}) => ({ bold: true, ...o });

/** A filled rectangle (Graphics.FillRectangle with a SolidBrush). */
function fill(parent: HTMLElement, x: number, y: number, w: number, h: number, css: string): HTMLDivElement {
    const d = el('div', 'es-fill');
    d.style.background = css;
    parent.appendChild(place(d, x, y, w, h));
    return d;
}

/** The summary sub-panels' GradientPanel (Main.InitializeComponent.cs: (39, 40, 44) / (22, 21, 26) / (51, 54, 61),
 *  border (67, 67, 77) width 2, curvature 20, all corners). */
function summaryPanel(className: string): HTMLDivElement {
    return gradientPanel({ corners: { tl: true, tr: true, br: true, bl: true }, radius: 20, className: `es-panel ${className}` });
}

// -------------------------------------------------------------------------------------------------------------------
// The window
// -------------------------------------------------------------------------------------------------------------------

/** Main.Part9.cs method_274: pnlEmpireSummary.Size. */
export const EMPIRE_SUMMARY_SIZE = { w: 1027, h: 770 } as const;

function createEmpireSummary(src: EmpireSummarySource): OpenState {
    const empire = src.empire;
    const galaxy = empire.galaxy as Galaxy;
    const isPirate = empire.pirateEmpireBaseHabitat !== null;
    const cleanup: (() => void)[] = [];

    const win = openOriginalWindow({
        id: 'summary',
        title: `${gt('Empire Summary')}: ${empire.name}`,
        width: EMPIRE_SUMMARY_SIZE.w,
        height: EMPIRE_SUMMARY_SIZE.h,
        onClose: () => {
            window.clearInterval(timer);
            for (const f of cleanup.splice(0)) f();
            // method_275: closing the summary also closes Empire Policy.
            if (isEmpirePolicyOpen()) closeEmpirePolicy();
            open = null;
        },
    });
    if (galaxy) void empireFlagUrl(galaxy, empire).then((u) => {
        if (!win.closed) win.setIcon(u);
    });
    const body = win.body;
    body.classList.add('es-body');

    // txtEmpireSummaryName: (120, 10) 308 × 20, font_7 (16.67 bold), (48, 48, 64) / (170, 170, 170).
    const name = textBox(empire.name, '', () => {});
    name.classList.add('es-name');
    // txtEmpireSummaryName_Leave (Main.Part9.cs:4306): a non-blank name renames the empire; the header title follows.
    // Committed on blur (Leave) and on Enter (which blurs the box).
    const commitName = (): void => {
        const text = name.value;
        if (galaxy === null || galaxy === undefined || text.trim() === '' || text.trim() === empire.name) {
            if (text.trim() === '') name.value = empire.name;
            return;
        }
        issuePlayerCommand(galaxy, empire, 'empireRename', [text], (ok) => {
            if (!ok || win.closed) return;
            win.setTitle(`${gt('Empire Summary')}: ${empire.name}`);
            if (document.activeElement !== name) name.value = empire.name;
        });
    };
    name.addEventListener('blur', commitName);
    name.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            name.blur();
        }
    });
    body.appendChild(place(name, 120, 10, 308, 20));

    // btnEmpireSummaryShowEmpirePolicy: (700, 10) 300 × 35 → method_595.
    const policy = glassButton(gt('Set Empire Policy & Automation').replace('&&', '&'), {
        onClick: () => {
            if (!isEmpirePolicyOpen()) toggleEmpirePolicy({ empire });
        },
    });
    body.appendChild(place(policy, 700, 10, 300, 35));

    // [freightOverlay] begin
    if (openTradeFlowsLink !== null) {
        const go = openTradeFlowsLink;
        const link = linkLabel('Where does the money go? →', () => {
            win.close();
            go();
        }, F.normal);
        link.classList.add('es-tradeflows');
        body.appendChild(place(link, 450, 20));
    }
    // [freightOverlay] end
    // [improvements] supplyChain: the resource supply panel, on the resource with the most unmet need (else the first).
    if (resourceSupplyAvailable()) {
        const link = linkLabel('Supply by resource →', () => openResourceSupply(mostNeededResource(galaxy, empire)), F.normal);
        link.classList.add('es-supply');
        link.title = 'Where each resource is produced, held and needed in your empire';
        body.appendChild(place(link, 450, 36));
    }

    // pnlEmpireSummaryColony: (10, 40) 420 × 300, transparent, no border (Ignite).
    const colony = el('div', 'es-colony');
    body.appendChild(place(colony, 10, 40, 420, 300));

    // The government controls (not for pirates).
    let selectedGovernment = -1;
    const governments = getGovernmentsStatic();
    let revolution: HTMLButtonElement | null = null;
    let syncGovernmentList: (() => void) | null = null;
    const updateRevolution = (): void => {
        if (revolution === null) return;
        const g = selectedGovernment >= 0 ? governments[selectedGovernment] : null;
        const st = revolutionButtonState(empire, selectedGovernment, g?.name ?? null);
        setButtonLabel(revolution, st.text);
        revolution.disabled = !st.enabled;
    };
    // Main.Part6.cs:3028 btnEmpireSummaryChangeGovernment_Click: the "Have a Revolution?" Yes / No box (method_372,
    // Question icon), then Empire.HaveRevolution(DominantRace, id) through the 'empireChangeGovernment' command.
    const onRevolution = async (): Promise<void> => {
        const id = selectedGovernment;
        const g = id >= 0 ? governments[id] : null;
        if (g === null || g === undefined || id === empire.governmentId || galaxy === null || galaxy === undefined) return;
        const answer = await messageBox({
            caption: gt('Have a Revolution?'),
            text: gt('Changing your style of government can have serious negative effects on your empire', g.name),
            buttons: ['Yes', 'No'],
            icon: 'question',
        });
        if (answer !== 'Yes' || win.closed) return;
        issuePlayerCommand(galaxy, empire, 'empireChangeGovernment', [id], () => {
            if (win.closed) return;
            updateRevolution();
            renderColony(); // pnlEmpireSummaryColony.Invalidate()
        });
    };
    if (!isPirate) {
        // lnkEmpireSummaryGovernmentType (271, 164): the selected government's Galactopedia page (or "Government Types").
        const about = linkLabel(gt('About this type of Government...'), () => {
            const g = selectedGovernment >= 0 ? governments[selectedGovernment] : null;
            openGalactopedia({ topic: g?.name ?? gt('Government Types') });
        }, FONT.normal);
        body.appendChild(place(about, 271, 164));
        // cmbEmpireSummaryChangeGovernmentType (271, 189) 155 × 21: "(Select government...)" + AllowableGovernmentTypes.
        // Main.Part9.cs 4242-4252: every allowable type (the current one too), in list order, built when the screen opens.
        const combo = dropDown([], '-1', (v) => {
            selectedGovernment = Number(v);
            updateRevolution();
            renderColony();
        });
        combo.classList.add('es-gov-combo');
        body.appendChild(place(combo, 271, 189, 155, 21));
        // Ours also follows a type unlocked while the screen is open (a government ruin): the list is rebuilt when
        // AllowableGovernmentTypes changes, keeping the pick if it is still listed.
        let listedGovernments = '';
        syncGovernmentList = (): void => {
            const key = empire.allowableGovernmentTypes.join(',');
            if (key === listedGovernments) return;
            listedGovernments = key;
            const options: { value: string; label: string }[] = [{ value: '-1', label: `(${gt('Select government...')})` }];
            for (const id of empire.allowableGovernmentTypes) {
                const g = governments[id];
                if (g) options.push({ value: String(id), label: g.name });
            }
            combo.replaceChildren(...options.map((o) => {
                const opt = document.createElement('option');
                opt.value = o.value;
                opt.textContent = o.label;
                return opt;
            }));
            if (!options.some((o) => o.value === String(selectedGovernment))) selectedGovernment = -1;
            combo.value = String(selectedGovernment);
        };
        syncGovernmentList();
        // btnEmpireSummaryChangeGovernment (10, 345) 420 × 50.
        revolution = glassButton('', { onClick: () => void onRevolution() });
        body.appendChild(place(revolution, 10, 345, 420, 50));
        updateRevolution();
    }

    // pnlEmpireSummaryEconomy (450, 54) 550 × 340.
    const economy = summaryPanel('es-economy');
    body.appendChild(place(economy, 450, 54, 550, 340));
    // pnlEmpireSummaryBonus (10, 412) 350 × 282: the title, then the scrolling container at (10, 35) 330 × 237.
    const bonus = summaryPanel('es-bonus');
    body.appendChild(place(bonus, 10, 412, 350, 282));
    lbl(bonus, gt('Bonuses'), 10, 10, bold({ size: F.title }));
    const bonusScroll = scrollPanel('es-bonus-scroll');
    bonus.appendChild(place(bonusScroll, 10, 35, 330, 237));
    // pnlEmpireSummaryBuiltObject (368, 412) 632 × 282.
    const ships = summaryPanel('es-ships');
    body.appendChild(place(ships, 368, 412, 632, 282));

    // ------------------------------------------------------------------------------------------------------------
    // EmpireSummaryColony.OnPaint
    // ------------------------------------------------------------------------------------------------------------
    function renderColony(): void {
        colony.replaceChildren();
        if (isPirate) renderPirateColony();
        else renderStandardColony();
    }

    function renderStandardColony(): void {
        // method_3: labels right-aligned to 103, values (bold) at 113, two pixels higher; rows 15 apart.
        colonyStatRows(galaxy, empire).forEach((r, i) => {
            const y = i * 15;
            lbl(colony, r.label, 103, y, { align: 'right' });
            const v = el('div', 'es-value-line');
            const val = text(r.value, { size: F.normal, bold: true, color: r.color ?? SUMMARY_COLORS.text });
            v.appendChild(val);
            if (r.rank !== undefined) v.appendChild(text(r.rank, { size: F.normal, color: SUMMARY_COLORS.text, className: 'es-rank' }));
            colony.appendChild(place(v, 113, y - 2));
        });
        // The government block: (0, 145) 256 × 200 in (40, 80, 80, 255), (257, 145) in (80, 80, 80, 80).
        // (Clipped to the 420 × 300 panel.)
        fill(colony, 0, 145, 256, 155, 'rgba(80, 80, 255, 0.157)');
        fill(colony, 257, 145, 420 - 257, 155, 'rgba(80, 80, 80, 0.314)');
        lbl(colony, gt('Government'), 4, 150, bold({ size: F.title }));
        const gov = governments[empire.governmentId];
        lbl(colony, gov?.name ?? src.governmentName ?? '', 113, 152, bold());
        if (gov) {
            governmentRows(gov).forEach((r, i) => {
                const y = 175 + i * 15;
                lbl(colony, r.label, 103, y, { align: 'right' });
                lbl(colony, r.value, 113, y - 2, bold({ color: r.color }));
            });
        }
        // The preview column for the government picked in the combo, at x 260.
        const next = selectedGovernment >= 0 ? governments[selectedGovernment] : null;
        if (next) {
            governmentRows(next).forEach((r, i) => lbl(colony, r.value, 260, 175 + i * 15 - 2, bold({ color: r.color })));
        }
    }

    function renderPirateColony(): void {
        // method_2: a flowing list (wrapped colony names) — lines 17 apart.
        const base = empire.pirateEmpireBaseHabitat as Habitat;
        lbl(colony, gt('Home Base'), 103, 1, { align: 'right' });
        const ports = [BuiltObjectSubRole.SmallSpacePort, BuiltObjectSubRole.MediumSpacePort, BuiltObjectSubRole.LargeSpacePort];
        const port = (base.basesAtHabitat ?? []).filter((b) => b != null && ports.includes(b.subRole)).pop();
        lbl(colony, port ? gt('Pirate Home Base at Location', port.name, base.name) : base.name, 113, 0, bold());
        lbl(colony, gt('Corruption'), 103, 18, { align: 'right' });
        lbl(colony, percent0(empire.corruption), 113, 17, bold());
        const flow = el('div', 'es-pirate-flow');
        colony.appendChild(place(flow, 0, 51, 420));
        const owned: string[] = [];
        const controlled: string[] = [];
        for (const h of empire.colonies) {
            if (h == null || h.hasBeenDestroyed) continue;
            if (h.empire === empire) owned.push(h.name);
            else if (h.pirateColonyControl.getByFaction(empire) !== null) controlled.push(h.name);
        }
        const heading = (s: string): void => {
            flow.appendChild(text(s, { size: F.normal, bold: true, color: SUMMARY_COLORS.text, className: 'es-flow-line' }));
        };
        const names = (s: string): void => {
            flow.appendChild(text(s, { size: F.normal, color: SUMMARY_COLORS.text, wrapWidth: 390, className: 'es-flow-line es-flow-indent es-flow-gap' }));
        };
        if (owned.length > 0) {
            heading(gt('Owned Colonies'));
            names(owned.join(', '));
        }
        heading(gt('Controlled Colonies'));
        names(controlled.length === 0 ? `(${gt('None')})` : controlled.join(', '));
        heading(gt('Pirate Playstyle Description', piratePlayStyleDescription(empire.piratePlayStyle)));
        for (const m of pirateModifierLines(empire.piratePlayStyle)) {
            flow.appendChild(text(m.text, { size: F.normal, color: m.color, className: 'es-flow-line es-flow-indent es-flow-tight' }));
        }
    }

    // ------------------------------------------------------------------------------------------------------------
    // EmpireSummaryEconomy.OnPaint
    // ------------------------------------------------------------------------------------------------------------
    function renderEconomy(): void {
        economy.replaceChildren();
        if (isPirate) renderPirateEconomy();
        else renderStandardEconomy();
    }

    function renderStandardEconomy(): void {
        // method_6. Columns: State labels right-aligned in [120, 255], values in [255, 315]; Private labels in
        // [335, 470], values in [470, 530]. Rows: cash 70, income 100, expenses 145, cashflow 250, bonus 280 (15 apart).
        const L = 120, LW = 135, V = 255, VW = 60, PL = 335, PLW = 135, PV = 470, PVW = 60;
        const yCash = 70, yIncome = 100, yExpenses = 145, yCashflow = 250, yBonus = 280, d = 2, row = 15;
        fill(economy, L - 4, yCash - 34, LW + VW + 12, yBonus - yCash + 75 + 8, 'rgba(80, 80, 255, 0.125)');
        fill(economy, PL - 4, yCash - 34, PLW + PVW + 12, yBonus - yCash + 75 + 8, 'rgba(80, 80, 80, 0.125)');
        fill(economy, V + 8, yCash - 34, VW, yBonus - yCash + 75 + 8, 'rgba(80, 80, 255, 0.157)');
        fill(economy, PV + 8, yCash - 34, PVW, yBonus - yCash + 75 + 8, 'rgba(80, 80, 80, 0.196)');
        const bandW = PV + PVW + 8 - 10;
        fill(economy, 10, yCash - 9, bandW, 34, 'rgba(100, 100, 100, 0.314)');
        fill(economy, 10, yExpenses - 4, bandW, row * 6 + 8, 'rgba(100, 100, 100, 0.314)');
        fill(economy, 10, yBonus - 4, bandW, row * 3 + 8, 'rgba(100, 100, 100, 0.314)');
        for (const y of [yCash - 9, yCashflow - 9]) {
            const box = el('div', 'es-pen');
            economy.appendChild(place(box, V + 8 - 1, y - 1, VW + 2, 34 + 2));
        }
        lbl(economy, gt('Economy'), 10, 10, bold({ size: F.title }));
        const help = linkLabel(gt('How does my empire make money?...'), () => openGalactopedia({ topic: gt('Economy Tips') }), F.normal);
        economy.appendChild(place(help, 323, 8));
        lbl(economy, gt('STATE'), L + (LW + VW) / 2, 40, bold({ align: 'center' }));
        lbl(economy, gt('PRIVATE'), PL + (PLW + VW) / 2, 40, bold({ align: 'center' }));
        const heads: [string, number][] = [['Cash on hand', yCash], ['Annual Income', yIncome], ['Annual Expenses', yExpenses], ['Cashflow', yCashflow], ["This Year's Bonus Income", yBonus]];
        for (const [k, y] of heads) lbl(economy, gt(k), 20, y - d, bold({ wrapWidth: 90 }));

        let b: EconomyBreakdown;
        try {
            b = computeEconomyBreakdown(galaxy, empire);
        } catch {
            return; // TODO(port): a sim path that still throws leaves the figures out.
        }
        const valueAt = (x: number, w: number, y: number, v: number, color: string, size: number = F.normal): void => {
            lbl(economy, formatK(v), x + w, y - d, bold({ align: 'right', color, size }));
        };
        const lineAt = (x: number, w: number, y: number, label: string): void => {
            lbl(economy, gt(label), x + w, y, { align: 'right' });
        };
        // State.
        valueAt(V, VW, yCash, b.state.cashOnHand, negativeColor(b.state.cashOnHand), F.title);
        b.state.income.forEach((l, i) => {
            lineAt(L, LW, yIncome + i * row, l.label);
            valueAt(V, VW, yIncome + i * row, l.value, i === 0 ? negativeColor(l.value) : SUMMARY_COLORS.text);
        });
        b.state.expenses.forEach((l, i) => {
            lineAt(L, LW, yExpenses + i * row, l.label);
            valueAt(V, VW, yExpenses + i * row, l.value, SUMMARY_COLORS.red);
        });
        valueAt(V, VW, yCashflow, b.state.cashflow, negativeColor(b.state.cashflow), F.title);
        b.state.bonusIncome.forEach((l, i) => {
            lineAt(L, LW, yBonus + i * row, l.label);
            valueAt(V, VW, yBonus + i * row, l.value, negativeColor(l.value));
        });
        // Private.
        valueAt(PV, PVW, yCash, b.private.cashOnHand, negativeColor(b.private.cashOnHand));
        b.private.income.forEach((l, i) => {
            lineAt(PL, PLW, yIncome + i * row, l.label);
            valueAt(PV, PVW, yIncome + i * row, l.value, negativeColor(l.value));
        });
        b.private.expenses.forEach((l, i) => {
            lineAt(PL, PLW, yExpenses + i * row, l.label);
            // Colony Taxes: method_7(AnnualTaxRevenue * -1); the others always red.
            valueAt(PV, PVW, yExpenses + i * row, l.value, i === 0 ? negativeColor(-l.value) : SUMMARY_COLORS.red);
        });
        valueAt(PV, PVW, yCashflow, b.private.cashflow, negativeColor(b.private.cashflow));
    }

    function renderPirateEconomy(): void {
        // method_2: Last Year / This Year columns for income [150, 210, 270] and expenses [420, 480, 540].
        const pe = empire.pirateEconomy;
        const last: PirateEconomyYear = pe.lastYear ?? emptyPirateYear();
        const now = pe.thisYear;
        lbl(economy, gt('Pirate Economy'), 10, 10, bold({ size: F.title }));
        const top = 40, off = -8;
        fill(economy, 150, top + off, 60, 253, 'rgba(128, 128, 128, 0.22)');
        fill(economy, 420, top + off, 60, 203, 'rgba(128, 128, 128, 0.22)');
        fill(economy, 210, top + off, 60, 253, 'rgba(128, 128, 128, 0.5)');
        fill(economy, 480, top + off, 60, 203, 'rgba(128, 128, 128, 0.5)');
        lbl(economy, gt('Income').toUpperCase(), 10, top, bold());
        lbl(economy, gt('Expenses').toUpperCase(), 290, top, bold());
        for (const [a, b2] of [[150, 210], [210, 270], [420, 480], [480, 540]] as const) {
            lbl(economy, gt(a === 150 || a === 420 ? 'Last Year' : 'This Year'), (a + b2) / 2, top + off, bold({ align: 'center' }));
        }
        const rowH = 17;
        const shade = ['rgba(96, 96, 96, 0.376)', 'rgba(64, 64, 64, 0.376)'];
        const line = (label: string, a: number, b2: number, y: number, x: number, c1: number, c2: number, c3: number, s: 0 | 1, color: string, total = false): void => {
            fill(economy, x, y, c3 - x, 17, shade[s]);
            lbl(economy, label, x, y, total ? bold() : {});
            lbl(economy, format0(a), c2 - 5, y, bold({ align: 'right', color }));
            lbl(economy, format0(b2), c3 - 5, y, bold({ align: 'right', color }));
            void c1;
        };
        let y = top + 20;
        const inc = (label: string, k: keyof PirateEconomyYear, s: 0 | 1): void => {
            line(gt(label), last[k] as number, now[k] as number, y, 20, 150, 210, 270, s, SUMMARY_COLORS.text);
            y += rowH;
        };
        lbl(economy, gt('Stable Income'), 10, y, bold());
        y += rowH;
        inc('Protection Agreements', 'protectionAgreementIncome', 0);
        inc('Controlled Colonies', 'controlColonyIncome', 1);
        lbl(economy, gt('Variable Income'), 10, y, bold());
        y += rowH;
        inc('Pirate Missions', 'missionIncome', 0);
        inc('Looting Destroyed Ships', 'lootingIncome', 1);
        inc('Scrapping Captured Ships', 'scrapCapturedShipIncome', 0);
        inc('Smuggling', 'smugglingIncome', 1);
        inc('Mining', 'miningIncome', 0);
        inc('Selling Information', 'sellInfoIncome', 1);
        inc('Resorts', 'resortIncome', 0);
        inc('Raids and Other', 'otherIncome', 1);
        line(gt('TOTAL'), last.totalIncome, now.totalIncome, y, 10, 150, 210, 270, 0, SUMMARY_COLORS.text, true);
        y = top + 20;
        const exp = (label: string, k: keyof PirateEconomyYear, s: 0 | 1): void => {
            line(gt(label), last[k] as number, now[k] as number, y, 300, 420, 480, 540, s, SUMMARY_COLORS.red);
            y += rowH;
        };
        lbl(economy, gt('Stable Expenses'), 290, y, bold());
        y += rowH;
        exp('Ship Maintenance', 'shipMaintenanceExpenses', 0);
        lbl(economy, gt('Variable Expenses'), 290, y, bold());
        y += rowH;
        exp('Construction', 'constructionExpenses', 1);
        exp('Resource Purchases', 'purchaseResourcesExpenses', 0);
        exp('Crash Research', 'crashResearchExpenses', 1);
        exp('Facility Building', 'facilityConstructionExpenses', 0);
        exp('Fuel', 'fuelExpenses', 1);
        exp('Other', 'otherExpenses', 0);
        line(gt('TOTAL'), last.totalExpenses, now.totalExpenses, y, 290, 420, 480, 540, 1, SUMMARY_COLORS.red, true);
        const pair = (label: string, v: number, x: number): void => {
            const d = el('div', 'es-value-line');
            d.appendChild(text(`${gt(label)}:`, { size: F.title, bold: true, color: SUMMARY_COLORS.text }));
            d.appendChild(text(format0(v), { size: F.title, bold: true, color: negativeColor(v), className: 'es-pair-value' }));
            economy.appendChild(place(d, x, 295));
        };
        pair('Cash on hand', empire.stateMoney, 10);
        pair('Stable Cashflow', (pe.lastYear ?? pe.thisYear).stableCashflow, 290);
    }

    // ------------------------------------------------------------------------------------------------------------
    // EmpireSummaryBonuses.DrawBonuses (+ our mod-layer rows)
    // ------------------------------------------------------------------------------------------------------------
    function bonusImageUrl(img: NonNullable<BonusLine['image']>): string {
        switch (img.kind) {
            case 'race': return racePortraitUrl(img.pictureIndex);
            case 'ruin': return `/assets/dwu/images/environment/ruins/ruin_${img.pictureRef}.png`;
            case 'facility': return facilityImageUrl(img.pictureRef);
            case 'character': return '';
        }
    }

    function renderBonuses(): void {
        const scroll = bonusScroll.scrollTop;
        bonusScroll.replaceChildren();
        const inner = el('div', 'es-bonus-list');
        bonusScroll.appendChild(inner);
        const lines = bonusLines(galaxy, empire);
        const abilityCount = abilityBonusLines(empire, true).length;
        lines.forEach((l, i) => {
            const row = el('div', 'es-bonus-line');
            if (i === abilityCount && i > 0) row.classList.add('es-bonus-gap');
            if (l.image !== null && l.image.kind === 'character') {
                // CharacterImageCache.ObtainCharacterImageSmall(Leader): the portrait with the role icon.
                const pic = characterPortrait(l.image.character, 'small', 15);
                pic.classList.add('es-bonus-img');
                pic.style.position = 'absolute';
                row.appendChild(pic);
            } else if (l.image !== null) {
                const img = el('img', 'es-bonus-img');
                img.src = bonusImageUrl(l.image);
                img.alt = '';
                img.draggable = false;
                img.addEventListener('error', () => img.remove());
                row.appendChild(img);
            }
            row.appendChild(text(l.text, { size: F.normal, color: SUMMARY_COLORS.text, wrapWidth: 290, className: 'es-bonus-text' }));
            inner.appendChild(row);
        });
        // Our addition: the mod-layer rows (stability, court, crises) under the bonuses.
        const extra = modLayerSummaryRows(galaxy, empire);
        if (extra.length > 0) {
            inner.appendChild(text('Empire Status', { size: F.normal, bold: true, color: SUMMARY_COLORS.text, className: 'es-bonus-heading' }));
            for (const r of extra) {
                const row = el('div', 'es-bonus-line es-extra-line');
                const t = text(`${r.label}: ${r.value}`, { size: F.normal, color: SUMMARY_COLORS.text, wrapWidth: 290, className: 'es-bonus-text' });
                if (r.title !== undefined) {
                    row.title = r.title;
                    t.classList.add('ow-hot');
                }
                row.appendChild(t);
                inner.appendChild(row);
            }
        }
        bonusScroll.scrollTop = scroll;
    }

    // ------------------------------------------------------------------------------------------------------------
    // EmpireSummaryBuiltObject.OnPaint (method_2)
    // ------------------------------------------------------------------------------------------------------------
    function renderShips(): void {
        ships.replaceChildren();
        lbl(ships, gt('Ships & Bases'), 10, 10, bold({ size: F.title }));
        const link = linkLabel(gt('About ship maintenance costs...'), () => openGalactopedia({ topic: gt('Ship Costs') }), F.normal);
        ships.appendChild(place(link, 443, 12));
        const top = 35;
        fill(ships, 10, top, 215, 235, 'rgba(80, 80, 255, 0.204)');
        fill(ships, 234, top, 188, 235, 'rgba(80, 80, 255, 0.11)');
        fill(ships, 432, top, 189, 235, 'rgba(80, 80, 80, 0.196)');
        const savings = empire.shipMaintenanceSavings;
        const xs = [-5, 234, 432];
        SHIP_COLUMNS.forEach((col, ci) => {
            const x = xs[ci];
            const list = (col.privateList ? empire.privateBuiltObjects : empire.builtObjects) ?? [];
            const titleText = col.title === 'PRIVATE' ? gt('PRIVATE') : gt(col.title).toUpperCase();
            lbl(ships, titleText, x + (ci === 0 ? 20 : 5), top + 4, bold());
            let y = top + 15;
            // method_3: the column headings.
            lbl(ships, gt('Amount Abbreviation'), x + 140, y, bold({ align: 'right' }));
            const maintRight = col.military ? x + 215 : x + 175;
            if (col.military) {
                // bitmap_38 (firepower.png), drawn unscaled over the firepower column.
                const fp = el('img', 'es-firepower');
                fp.src = chromeImageUrl('firepower.png');
                fp.alt = '';
                fp.title = gt('Firepower');
                ships.appendChild(place(fp, x + 180 - 13, y + 2));
            }
            // The original ends "Maint" at x + 200 (x + 164 off the military column), over the neighbouring heading in
            // this font; it is aligned with the maintenance figures instead.
            lbl(ships, gt('Maintenance Abbreviation'), maintRight, y, bold({ align: 'right' }));
            y += 15 + 8;
            col.rows.forEach((spec, ri) => {
                if (spec.gapBefore && ri > 0) y += 8;
                const s = shipRoleStats(list, spec.roles, savings);
                lbl(ships, shipRowLabel(spec), x + 105, y, { align: 'right' });
                lbl(ships, String(s.count), x + 140, y - 2, bold({ align: 'right' }));
                if (col.military) lbl(ships, formatFirepower(s.firepower), x + 180, y, { align: 'right' });
                lbl(ships, formatK(s.maintenance), maintRight, y, { align: 'right' });
                y += 15;
            });
            y += 8;
            // method_4: the column total.
            const all = col.rows.flatMap((r) => r.roles);
            const t = shipRoleStats(list, all, savings);
            lbl(ships, gt('TOTAL'), x + 105, y - 2, bold({ align: 'right' }));
            lbl(ships, String(t.count), x + 140, y - 2, bold({ align: 'right' }));
            if (col.military) lbl(ships, formatFirepower(t.firepower), x + 180, y, { align: 'right' });
            lbl(ships, formatK(t.maintenance), maintRight, y, { align: 'right' });
        });
    }

    const renderAll = (): void => {
        if (win.closed) return;
        win.setTitle(`${gt('Empire Summary')}: ${empire.name}`);
        if (document.activeElement !== name && name.value !== empire.name) name.value = empire.name;
        if (syncGovernmentList !== null) {
            const before = selectedGovernment;
            syncGovernmentList();
            if (selectedGovernment !== before) updateRevolution();
        }
        renderColony();
        renderEconomy();
        renderBonuses();
        renderShips();
    };
    renderAll();
    // The original repaints on Invalidate; refresh the figures once a second.
    // Worker mode: bring what the screen shows up to date now instead of up to a cold cycle later (no-op in-thread).
    requestSimRefresh(galaxy, [empire], () => {
        if (!win.closed) renderAll();
    });
    const timer = window.setInterval(renderAll, 1000);

    const state: OpenState = { win, close: () => win.close() };
    return state;
}

/** A zeroed PirateEconomyYear stand-in (the original builds `new PirateEconomyYear(CurrentStarDate)` when LastYear is
 *  null). */
function emptyPirateYear(): PirateEconomyYear {
    const z = {
        protectionAgreementIncome: 0, miningIncome: 0, lootingIncome: 0, missionIncome: 0, sellInfoIncome: 0, controlColonyIncome: 0,
        smugglingIncome: 0, scrapCapturedShipIncome: 0, resortIncome: 0, otherIncome: 0, shipMaintenanceExpenses: 0, constructionExpenses: 0,
        purchaseResourcesExpenses: 0, crashResearchExpenses: 0, facilityConstructionExpenses: 0, fuelExpenses: 0, otherExpenses: 0,
        totalIncome: 0, totalExpenses: 0, stableCashflow: 0,
    };
    return z as unknown as PirateEconomyYear;
}
