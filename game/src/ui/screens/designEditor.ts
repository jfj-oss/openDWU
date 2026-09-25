// Design editor panel (task 17f): a streamlined port of the original's pnlDesignDetail
// (Main.Part8.cs:46 OpenDesignEditor, Main.Part9.cs:5030 method_292 binding), opened from the Ship Designs panel
// (F8, shipDesigns.ts) by its New / Edit / Copy / Upgrade buttons. All rules live in src/sim/player/designEditor.ts;
// this file only wires them: the component toolbox grouped by family (add ×1 / ×5), the design's summarized
// component list (remove ×1 / ×5), the warnings pane (red = must fix, Main.Part6.cs:226), name / sub-role /
// tactics / flee / retrofit / obsolete controls, cost and stats, Save / Cancel.
//
// TODO(port): ship picture combo + image scaling (cmbDesignsPicture, cmbDesignImageScalingMode) — image-only.
// TODO(port): component detail panel, weapons grid and fighter/boarding readouts (pnlDesignComponentDetail,
//   ctlDesignWeapons, Main.Part9.cs:5071-5140) and the component guide / construction summary buttons.
// TODO(port): repair-priority template picker (_btnRepairPrioritySelect, ExpansionMod) — not modelled.

import './designEditor.css';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { Design } from '../../sim/design';
import type { ComponentDefinition } from '../../sim/componentStatic';
import { BuiltObjectSubRole } from '../../sim/builtObjectTypes';
import { resolveSubRoleDescription } from '../../sim/designGeneration';
import { designCalculateMaintenanceCosts } from '../../sim/construction/empireConstruction';
import { getText, resolveGameText } from '../../sim/textResolver';
import { gameText } from '../../sim/colonyTick';
import {
    BATTLE_TACTICS_CHOICES,
    DESIGN_SUBROLE_CHOICES,
    FLEE_WHEN_CHOICES,
    INVASION_TACTICS_CHOICES,
    addComponent,
    designAutomationPromptApplies,
    designToolboxComponents,
    designUpgradeExplanation,
    designWarnings,
    removeComponent,
    resolveBattleTacticsDescription,
    resolveFleeWhenDescription,
    resolveInvasionTacticsDescription,
    saveDesign,
    setDraftSubRole,
    summarizeComponents,
    toolboxByFamily,
    type DesignDraft,
    type DesignDraftSource,
} from '../../sim/player/designEditor';
import { designStatRows, isPrivateDesignSubRole } from './shipDesigns';
import { formatMoney } from '../hud';

export interface DesignEditorOptions {
    galaxy: Galaxy;
    empire: Empire;
    draft: DesignDraft;
    /** Which Designs-panel button opened the editor (for the ControlDesigns prompt). */
    sourceKind: DesignDraftSource['kind'];
    /** The selected design the session started from (Copy / Upgrade / Edit), for the prompt. */
    sourceDesign: Design | null;
    /** Called once when the editor closes; `saved` is the design now in Empire.Designs, or null on cancel. */
    onClose: (saved: Design | null) => void;
}

export interface DesignEditorHandle {
    close: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

function button(text: string, className = 'design-editor-button'): HTMLButtonElement {
    const b = el('button', className, text);
    b.type = 'button';
    return b;
}

/** A combo over enum values; `value` Undefined (0) shows no selection, like method_281-284's -1. */
function enumSelect<V extends number>(values: readonly V[], label: (v: V) => string, value: V, onChange: (v: V) => void): HTMLSelectElement {
    const sel = el('select', 'design-editor-select');
    for (const v of values) {
        const o = document.createElement('option');
        o.value = String(v);
        o.textContent = label(v);
        sel.appendChild(o);
    }
    sel.value = values.includes(value) ? String(value) : '';
    if (!values.includes(value)) sel.selectedIndex = -1;
    sel.addEventListener('change', () => onChange(Number(sel.value) as V));
    return sel;
}

/** Open the editor over the Ship Designs panel. */
export function openDesignEditor(opts: DesignEditorOptions): DesignEditorHandle {
    const { galaxy, empire, draft } = opts;
    const design = draft.design;
    const view = draft.mode === 'view';
    let closed = false;

    const root = el('div', 'design-editor-wrap');
    const win = el('div', 'design-editor-window');
    root.appendChild(win);

    // Title bar: Main.Part8.cs:65-70 "Edit Design: <name>" / "View Design: <name>".
    const titlebar = el('div', 'design-editor-titlebar');
    const heading = el('div', 'design-editor-heading');
    const closeBtn = button('✕', 'design-editor-close');
    closeBtn.title = getText('Cancel');
    titlebar.append(heading, closeBtn);
    win.appendChild(titlebar);

    // ControlDesigns prompt (GenerateAutomationMessageBox, Main.Part12.cs:4453) as an inline banner.
    if (designAutomationPromptApplies(empire, opts.sourceKind, opts.sourceDesign)) {
        const banner = el('div', 'design-editor-banner');
        const task = getText('Ship Design');
        banner.appendChild(el('span', 'design-editor-banner-text', resolveGameText(gameText('Turn Off TASKNAME Automation?', task))));
        const leave = button(getText('Leave automation on'));
        const off = button(getText('Turn off automation'));
        leave.addEventListener('click', () => banner.remove());
        off.addEventListener('click', () => {
            empire.controlDesigns = false;
            banner.remove();
        });
        banner.append(leave, off);
        win.appendChild(banner);
    }

    // Header row: name, sub-role, obsolete, size, cost, save / cancel.
    const header = el('div', 'design-editor-header');
    const nameInput = el('input', 'design-editor-input');
    nameInput.type = 'text';
    nameInput.value = design.name;
    nameInput.disabled = view;
    nameInput.placeholder = getText('Name');
    // PrepareDesignForEditor reads txtDesignName.Text; txtDesignName_Leave refreshes the warnings.
    nameInput.addEventListener('input', () => { design.name = nameInput.value; updateTitle(); });
    nameInput.addEventListener('change', () => refresh());

    const subRoleSel = el('select', 'design-editor-select');
    for (const s of DESIGN_SUBROLE_CHOICES) {
        const o = document.createElement('option');
        o.value = String(s);
        o.textContent = resolveSubRoleDescription(s);
        subRoleSel.appendChild(o);
    }
    subRoleSel.disabled = view;
    subRoleSel.addEventListener('change', () => {
        setDraftSubRole(empire, draft, Number(subRoleSel.value) as BuiltObjectSubRole);
        syncControls();
        refresh();
    });

    const obsoleteLabel = el('label', 'design-editor-check');
    const obsoleteBox = el('input', '');
    obsoleteBox.type = 'checkbox';
    obsoleteBox.checked = design.isObsolete;
    obsoleteBox.addEventListener('change', () => { design.isObsolete = obsoleteBox.checked; });
    obsoleteLabel.append(obsoleteBox, document.createTextNode(getText('Mark as Obsolete')));

    const sizeLabel = el('span', 'design-editor-size');
    const costLabel = el('span', 'design-editor-cost');
    const saveBtn = button(getText('Save'), 'design-editor-button design-editor-save');
    const cancelBtn = button(getText('Cancel'));
    header.append(nameInput, subRoleSel, obsoleteLabel, sizeLabel, costLabel, saveBtn, cancelBtn);
    win.appendChild(header);

    // Behaviour row: the tactics / flee / retrofit combos (Main.Part8.cs:140-200, :80-100).
    const behaviour = el('div', 'design-editor-behaviour');
    const labelled = (text: string, control: HTMLElement): HTMLElement => {
        const w = el('label', 'design-editor-field');
        w.append(el('span', 'design-editor-field-label', text), control);
        return w;
    };
    const strongerSel = enumSelect(BATTLE_TACTICS_CHOICES, resolveBattleTacticsDescription, design.tacticsStrongerShips, (v) => { design.tacticsStrongerShips = v; refresh(); });
    const weakerSel = enumSelect(BATTLE_TACTICS_CHOICES, resolveBattleTacticsDescription, design.tacticsWeakerShips, (v) => { design.tacticsWeakerShips = v; refresh(); });
    const invasionSel = enumSelect(INVASION_TACTICS_CHOICES, resolveInvasionTacticsDescription, design.tacticsInvasion, (v) => { design.tacticsInvasion = v; refresh(); });
    const fleeSel = enumSelect(FLEE_WHEN_CHOICES, resolveFleeWhenDescription, design.fleeWhen, (v) => { design.fleeWhen = v; refresh(); });
    // cmbDesignDetailAutoRetrofit (Main.Part8.cs:84-100; disabled for the six private sub-roles).
    const retrofitSel = el('select', 'design-editor-select');
    for (const [v, key] of [[1, 'Auto Retrofit (including advisor suggestions)'], [0, 'Only Retrofit When Manually Ordered']] as const) {
        const o = document.createElement('option');
        o.value = String(v);
        o.textContent = getText(key);
        retrofitSel.appendChild(o);
    }
    retrofitSel.addEventListener('change', () => { design.allowAutoRetrofit = retrofitSel.value === '1'; });
    behaviour.append(
        labelled(getText('Stronger Opponents'), strongerSel),
        labelled(getText('Weaker Opponents'), weakerSel),
        labelled(getText('Invasion'), invasionSel),
        labelled(getText('Flee When'), fleeSel),
        labelled(getText('Default Retrofit Stance'), retrofitSel),
    );
    win.appendChild(behaviour);
    const explanation = el('div', 'design-editor-explanation');
    win.appendChild(explanation);

    // Body: toolbox | design components | warnings + stats.
    const body = el('div', 'design-editor-body');
    const toolboxPane = el('div', 'design-editor-pane design-editor-toolbox');
    const componentsPane = el('div', 'design-editor-pane design-editor-components');
    const sidePane = el('div', 'design-editor-pane design-editor-side');
    body.append(toolboxPane, componentsPane, sidePane);
    win.appendChild(body);
    const statusLine = el('div', 'design-editor-status');
    win.appendChild(statusLine);
    document.body.appendChild(root);

    // Toolbox (Main.Part9.cs:5018 method_290: researched components), grouped by family; built once.
    toolboxPane.appendChild(el('div', 'design-editor-section', getText('Components')));
    for (const group of toolboxByFamily(designToolboxComponents(empire))) {
        const details = el('details', 'design-editor-family');
        details.open = true;
        details.appendChild(el('summary', 'design-editor-family-label', `${group.label} (${group.components.length})`));
        for (const c of group.components) details.appendChild(toolboxRow(c));
        toolboxPane.appendChild(details);
    }

    function toolboxRow(c: ComponentDefinition): HTMLElement {
        const row = el('div', 'design-editor-row');
        row.append(el('span', 'design-editor-row-name', c.name), el('span', 'design-editor-row-size', String(c.size)));
        const add1 = button('+', 'design-editor-mini');
        const add5 = button('+5', 'design-editor-mini');
        add1.title = getText('Add');
        add1.disabled = view;
        add5.disabled = view;
        add1.addEventListener('click', () => { if (addComponent(empire, draft, c, 1).ok) refresh(); });
        add5.addEventListener('click', () => { if (addComponent(empire, draft, c, 5).ok) refresh(); });
        row.append(add1, add5);
        return row;
    }

    const componentsList = el('div', 'design-editor-list');
    componentsPane.append(el('div', 'design-editor-section', getText('Design')), componentsList);
    const warningsBox = el('div', 'design-editor-warnings');
    const statsBox = el('div', 'design-editor-stats');
    sidePane.append(el('div', 'design-editor-section', getText('Warnings')), warningsBox, el('div', 'design-editor-divider'), statsBox);

    function updateTitle(): void {
        const title = view ? getText('View Design') : getText('Edit Design');
        heading.textContent = design.name !== '' ? `${title}: ${design.name}` : title;
    }

    function syncControls(): void {
        subRoleSel.value = String(design.subRole);
        if (design.subRole === BuiltObjectSubRole.Undefined) subRoleSel.selectedIndex = -1;
        const set = (sel: HTMLSelectElement, v: number): void => {
            sel.value = String(v);
            if (sel.value !== String(v)) sel.selectedIndex = -1;
        };
        set(strongerSel, design.tacticsStrongerShips);
        set(weakerSel, design.tacticsWeakerShips);
        set(invasionSel, design.tacticsInvasion);
        set(fleeSel, design.fleeWhen);
        retrofitSel.value = design.allowAutoRetrofit ? '1' : '0';
        retrofitSel.disabled = isPrivateDesignSubRole(design.subRole);
        obsoleteBox.checked = design.isObsolete;
        explanation.textContent = design.subRole === BuiltObjectSubRole.Undefined ? '' : resolveGameText(designUpgradeExplanation(empire, design));
    }

    // Refresh everything that depends on the component list (method_292 with bool_28 = false + the warnings).
    function refresh(): void {
        updateTitle();
        sizeLabel.textContent = `${getText('Size')}: ${design.size}`;
        costLabel.textContent = `${getText('Purchase Cost')}: ${formatMoney(design.calculateCurrentPurchasePrice(galaxy))} · `
            + `${getText('Maintenance Cost')}: ${formatMoney(designCalculateMaintenanceCosts(galaxy, design, empire))}`;

        componentsList.replaceChildren();
        const summary = summarizeComponents(design);
        if (summary.length === 0) componentsList.appendChild(el('div', 'design-editor-empty', `(${getText('None')})`));
        for (const { component, count } of summary) {
            const row = el('div', 'design-editor-row');
            row.append(
                el('span', 'design-editor-row-count', `${count}×`),
                el('span', 'design-editor-row-name', component.name),
                el('span', 'design-editor-row-size', String(component.size * count)),
            );
            const rem1 = button('−', 'design-editor-mini');
            const rem5 = button('−5', 'design-editor-mini');
            rem1.title = getText('Remove');
            rem1.disabled = view;
            rem5.disabled = view;
            rem1.addEventListener('click', () => { if (removeComponent(draft, component, 1).ok) refresh(); });
            rem5.addEventListener('click', () => { if (removeComponent(draft, component, 5).ok) refresh(); });
            row.append(rem1, rem5);
            componentsList.appendChild(row);
        }

        // pnlDesignWarnings.Ignite(mustDo in red, shouldDo in yellow).
        const { mustDo, shouldDo } = designWarnings(galaxy, empire, design);
        warningsBox.replaceChildren();
        for (const w of mustDo) warningsBox.appendChild(el('div', 'design-editor-warning design-editor-must', resolveGameText(w)));
        for (const w of shouldDo) warningsBox.appendChild(el('div', 'design-editor-warning design-editor-should', resolveGameText(w)));
        if (mustDo.length + shouldDo.length === 0) warningsBox.appendChild(el('div', 'design-editor-empty', `(${getText('None')})`));

        statsBox.replaceChildren();
        for (const { label, value } of designStatRows(design)) {
            statsBox.append(el('span', 'design-editor-stat-label', label), el('span', 'design-editor-stat-value', value));
        }
    }

    function close(saved: Design | null = null): void {
        if (closed) return;
        closed = true;
        root.remove();
        opts.onClose(saved);
    }

    saveBtn.addEventListener('click', () => {
        design.name = nameInput.value;
        const r = saveDesign(galaxy, empire, draft);
        if (!r.ok) {
            statusLine.textContent = `${resolveGameText(r.title ?? '')}: ${resolveGameText(r.message ?? '')}`;
            refresh();
            return;
        }
        close(r.design);
    });
    cancelBtn.addEventListener('click', () => close(null));
    closeBtn.addEventListener('click', () => close(null));

    if (view) {
        statusLine.textContent = `${getText('Cannot edit this design')}: ${getText('You cannot edit this design because it is already in use')}`;
    }
    syncControls();
    refresh();
    nameInput.focus();
    return { close: () => close(null) };
}
