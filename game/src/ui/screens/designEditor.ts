// Design Editor: a port of the original pnlDesignDetail (a 1010 × 783 BorderPanel with no header) on the shared
// original-style window (../originalWindow.ts), opened from the Designs window (shipDesigns.ts) by Edit / Add New /
// Copy As New / Manually Upgrade Design. Every rule lives in src/sim/player/designEditor.ts; this file lays the controls
// out where the original puts them and wires them to the draft.
// Sources:
// - DistantWorlds/Main.Part8.cs:46 OpenDesignEditor (every Location / Size below), Main.Part9.cs:5030 method_292 (the
//   binding: size, combos, weapons panel values), Main.Part7.cs:4971 method_385 (costs), :4984-5110 the add / remove
//   buttons, :4907-4955 the picture combo, Main.Part2.cs:4570 the image scaling combo, Main.Part6.cs:164
//   btnDesignsSaveDesign_Click, Main.Part7.cs:4890 btnDesignsCancel_Click, Main.Part6.cs:1020 / :1033 the component
//   lists' SelectionChanged → pnlDesignComponentDetail;
// - DistantWorlds.Controls/Controls/DesignWarnings.cs, DesignEnergy.cs, DesignMovement.cs, DesignIndustry.cs,
//   DesignDefense.cs, ComponentDetail.cs, ComponentListView.cs, WeaponListView.cs (models in designPanelsModel.ts).
// Our additions: a component-family filter over the toolbox (the streamlined editor grouped it by family), the picture
// chooser organised by ship family, double-click to add / remove a component, Enter in the name box saves.
// TODO(port): "Only Show Latest Components" (Main.Part9.cs:4900 Kdxguwronl — needs ResearchSystem.GetLatestComponents);
//   the repair-priority template picker (_btnRepairPrioritySelect, ExpansionMod); the Component Guide and Construction
//   Summary windows (Main.Part4.cs:3425 / :3435); the empire-colour tint of the ship picture (PrepareBuiltObjectImage).

import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { Design } from '../../sim/design';
import type { ComponentDefinition } from '../../sim/componentStatic';
import { BuiltObjectSubRole } from '../../sim/builtObjectTypes';
import { DesignImageScalingMode } from '../../sim/data/designSpecifications';
import { resolveSubRoleDescription } from '../../sim/designGeneration';
import { designCalculateMaintenanceCosts } from '../../sim/construction/empireConstruction';
import { determineResourcesEmpireSupplies } from '../../sim/diplomacyTick';
import { resolveGameText } from '../../sim/textResolver';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import {
    BATTLE_TACTICS_CHOICES,
    DESIGN_SUBROLE_CHOICES,
    FLEE_WHEN_CHOICES,
    INVASION_TACTICS_CHOICES,
    addComponent,
    designToolboxComponents,
    designUpgradeExplanation,
    designWarnings,
    removeComponent,
    resolveBattleTacticsDescription,
    resolveComponentCategoryDescription,
    resolveFleeWhenDescription,
    resolveInvasionTacticsDescription,
    setDraftSubRole,
    summarizeComponents,
    type DesignDraft,
    type DesignDraftSource,
} from '../../sim/player/designEditor';
import { isPrivateDesignSubRole } from '../../sim/player/playerOrders';
import {
    COLORS,
    FONT,
    OwGrid,
    checkBox,
    dropDown,
    dropText,
    el,
    glassButton,
    gradientPanel,
    messageBox,
    openOriginalWindow,
    place,
    scrollPanel,
    setText,
    text,
    textBox,
    type OriginalWindow,
} from '../originalWindow';
import {
    MOVEMENT_COLUMNS,
    MOVEMENT_ROWS,
    SHIP_PICTURE_COUNT,
    componentCategoryAbbreviation,
    componentDetailModel,
    componentImageUrl,
    designDefenseRows,
    designEnergyPanel,
    designIndustryPanel,
    designMovementPanel,
    designWeaponRows,
    designWeaponSummary,
    calculateTotalWeaponsEnergyUsePerSecond,
    gt,
    missingComponentResources,
    shipPictureGroups,
    type StatRow,
} from './designPanelsModel';
import { builtObjectImageUrl } from '../../render/builtObjectLayer';

export interface DesignEditorOptions {
    galaxy: Galaxy;
    empire: Empire;
    draft: DesignDraft;
    /** Which Designs-window button opened the editor. */
    sourceKind: DesignDraftSource['kind'];
    /** The selected design the session started from (Copy / Upgrade / Edit). */
    sourceDesign: Design | null;
    /** Called once when the editor closes; `saved` is the design now in Empire.Designs, or null on cancel. */
    onClose: (saved: Design | null) => void;
}

export interface DesignEditorHandle {
    close: () => void;
}

/** pnlDesignDetail.Size (Main.Part8.cs:60). */
export const DESIGN_EDITOR_SIZE = { w: 1010, h: 783 } as const;
/** BorderPanel's 3 px border: the headerless window's body starts there, the original's Locations do not. */
const B = 3;
/** The small Verdana 8.25 pt labels and combos of pnlDesignDetail, as a GenerateFont pixel size. */
const SMALL = FONT.tiny;
const GREY = 'rgb(170, 170, 170)';

/** place() in pnlDesignDetail's own coordinates (its Locations include the 3 px border). */
function at<T extends HTMLElement>(e: T, x: number, y: number, w?: number, h?: number): T {
    return place(e, x - B, y - B, w, h);
}

/** A combo over enum values; a value not in the list shows no selection (method_281-284's -1). */
function enumDropDown<V extends number>(values: readonly V[], label: (v: V) => string, value: V, onChange: (v: V) => void): HTMLSelectElement {
    const s = dropDown(values.map((v) => ({ value: String(v), label: label(v) })), String(value), (v) => onChange(Number(v) as V));
    if (!values.includes(value)) s.selectedIndex = -1;
    s.style.fontSize = `${SMALL}px`;
    return s;
}

function setSelect(s: HTMLSelectElement, v: number): void {
    s.value = String(v);
    if (s.value !== String(v)) s.selectedIndex = -1;
}

/** A GradientPanel in the editor's standard colours (BorderWidth 2, the given Curvature, all corners). */
function editorPanel(radius = 20): HTMLDivElement {
    return gradientPanel({ corners: { tl: true, tr: true, br: true, bl: true }, radius: Math.round(radius / 2), className: 'dsgx-panel' });
}

/** The panels' "label right-aligned in `width` from `x`, bold value at `vx`" rows (DesignDefense / DesignEnergy …). */
function statRows(parent: HTMLElement, rows: readonly StatRow[], x: number, width: number, vx: number, y: number, rowHeight: number, valueDy = 0): number {
    for (const r of rows) {
        const l = text(r.label, { size: FONT.normal, color: GREY });
        l.classList.add('ow-right');
        parent.appendChild(place(l, x + width, y));
        parent.appendChild(place(text(r.value, { size: FONT.normal, bold: true, color: r.color ?? GREY }), vx, y - valueDy));
        y += rowHeight;
    }
    return y;
}

/** Open the editor over the Designs window. */
export function openDesignEditor(opts: DesignEditorOptions): DesignEditorHandle {
    const { galaxy, empire, draft } = opts;
    const design = draft.design;
    const view = draft.mode === 'view';
    let saved: Design | null = null;
    let pictureChooser: HTMLElement | null = null;

    const win: OriginalWindow = openOriginalWindow({
        id: 'design-editor',
        title: '',
        headerless: true,
        width: DESIGN_EDITOR_SIZE.w,
        height: DESIGN_EDITOR_SIZE.h,
        onClose: () => opts.onClose(saved),
    });
    win.root.classList.add('dsgx-layer');
    const body = win.body;
    body.classList.add('dsgx-body');

    // ---- Header row -------------------------------------------------------------------------------------------------
    // lblDesignDetailTitle (10, 10) font_1, white: "Edit Design: <name>" / "View Design: <name>".
    const title = at(text('', { size: FONT.title, bold: true, color: '#fff' }), 10, 10);
    const purchase = at(text('', { size: SMALL, color: GREY }), 458, 7);
    const maintenance = at(text('', { size: SMALL, color: GREY }), 445, 21);
    const obsolete = at(checkBox(gt('Mark as Obsolete'), design.isObsolete, view ? null : (v) => { design.isObsolete = v; }, SMALL), 610, 12);
    const saveBtn = at(glassButton(gt('Save'), { onClick: () => save() }), 750, 8, 120, 25);
    const cancelBtn = at(glassButton(gt('Cancel'), { onClick: () => win.close() }), 880, 8, 120, 25);
    body.append(title, purchase, maintenance, obsolete, saveBtn, cancelBtn);
    // lblDesignDetailAutoRetrofit (5, 42) + cmbDesignDetailAutoRetrofit (125, 40) 230 × 21.
    body.appendChild(at(text(gt('Default Retrofit Stance'), { size: SMALL, color: GREY }), 5, 42));
    const retrofit = dropDown(
        [
            { value: '1', label: gt('Auto Retrofit (including advisor suggestions)') },
            { value: '0', label: gt('Only Retrofit When Manually Ordered') },
        ],
        design.allowAutoRetrofit ? '1' : '0',
        (v) => { design.allowAutoRetrofit = v === '1'; },
    );
    retrofit.style.fontSize = `${SMALL}px`;
    body.appendChild(at(retrofit, 125, 40, 230, 21));
    // lblDesignDetailUpgradeRolesExplanation (370, 38) 630 × 30, MiddleLeft.
    const explanationBox = at(el('div', 'dsgx-middle'), 370, 38, 630, 30);
    const explanation = text('', { size: SMALL, color: GREY, wrapWidth: 630 });
    explanation.style.position = 'static';
    explanationBox.appendChild(explanation);
    body.appendChild(explanationBox);

    // ---- pnlDesignBasics (10, 71) 350 × 170 ------------------------------------------------------------------------
    const basics = at(editorPanel(20), 10, 71, 350, 170);
    body.appendChild(basics);
    dropText(basics, gt('Size'), 4, 12, { size: SMALL, color: GREY });
    const sizeValue = dropText(basics, '0', 50, 7, { size: FONT.header, bold: true, color: '#fff' });
    dropText(basics, gt('Role'), 5, 37, { size: SMALL, color: GREY });
    const subRole = enumDropDown(DESIGN_SUBROLE_CHOICES, resolveSubRoleDescription, design.subRole, (v) => {
        setDraftSubRole(empire, draft, v as BuiltObjectSubRole);
        refresh();
    });
    basics.appendChild(place(subRole, 83, 35, 120, 20));
    dropText(basics, gt('Stronger Opponents'), 4, 62, { size: SMALL, color: GREY });
    const stronger = enumDropDown(BATTLE_TACTICS_CHOICES, resolveBattleTacticsDescription, design.tacticsStrongerShips, (v) => { design.tacticsStrongerShips = v; refresh(); });
    basics.appendChild(place(stronger, 133, 60, 70, 20));
    dropText(basics, gt('Weaker Opponents'), 4, 87, { size: SMALL, color: GREY });
    const weaker = enumDropDown(BATTLE_TACTICS_CHOICES, resolveBattleTacticsDescription, design.tacticsWeakerShips, (v) => { design.tacticsWeakerShips = v; refresh(); });
    basics.appendChild(place(weaker, 133, 85, 70, 20));
    dropText(basics, gt('Invasion'), 5, 112, { size: SMALL, color: GREY });
    const invasion = enumDropDown(INVASION_TACTICS_CHOICES, resolveInvasionTacticsDescription, design.tacticsInvasion, (v) => { design.tacticsInvasion = v; refresh(); });
    basics.appendChild(place(invasion, 83, 110, 120, 20));
    dropText(basics, gt('Flee When'), 5, 137, { size: SMALL, color: GREY });
    const flee = enumDropDown(FLEE_WHEN_CHOICES, resolveFleeWhenDescription, design.fleeWhen, (v) => { design.fleeWhen = v; refresh(); });
    basics.appendChild(place(flee, 83, 135, 120, 20));
    // lblDesignImageScalingMode (130, 9), cmbDesignImageScalingMode (210, 7) 70 × 21, numDesignImageScalingAmount (285, 7).
    dropText(basics, gt('Image Scaling Mode'), 130, 9, { size: SMALL, color: GREY });
    const scalingNames: Record<number, string> = { [DesignImageScalingMode.None]: 'None', [DesignImageScalingMode.Absolute]: 'Absolute', [DesignImageScalingMode.Scaled]: 'Scaled' };
    const scaling = enumDropDown(
        [DesignImageScalingMode.None, DesignImageScalingMode.Absolute, DesignImageScalingMode.Scaled],
        (v) => gt(scalingNames[v]),
        design.imageScalingType,
        (v) => setScalingMode(v),
    );
    basics.appendChild(place(scaling, 210, 7, 70, 21));
    const amount = el('input', 'ow-input dsgx-number');
    amount.type = 'number';
    amount.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    amount.addEventListener('change', () => {
        const v = Number(amount.value);
        if (Number.isFinite(v)) {
            const clamped = Math.min(Number(amount.max), Math.max(Number(amount.min), v));
            amount.value = String(clamped);
            design.imageScalingFactor = Math.fround(clamped);
        }
    });
    basics.appendChild(place(amount, 285, 7, 55, 21));
    /** Main.Part2.cs:4570 cmbDesignImageScalingMode_SelectedIndexChanged: each mode's range, step and default. */
    function setScalingMode(mode: DesignImageScalingMode, keepValue = false): void {
        const cfg = mode === DesignImageScalingMode.Absolute
            ? { on: true, min: 10, max: 1000, step: 1, value: 100 }
            : mode === DesignImageScalingMode.Scaled
              ? { on: true, min: 0.05, max: 10, step: 0.01, value: 1 }
              : { on: false, min: 0, max: 1000, step: 0.01, value: 1 };
        amount.disabled = view || !cfg.on;
        amount.min = String(cfg.min);
        amount.max = String(cfg.max);
        amount.step = String(cfg.step);
        const value = keepValue ? design.imageScalingFactor : cfg.value;
        amount.value = String(+value.toFixed(2));
        design.imageScalingType = mode;
        design.imageScalingFactor = Math.fround(value);
    }
    // cmbDesignsPicture (210, 34) 130 × 119: the design's ship picture; click for the chooser.
    const picture = el('button', 'dsgx-picture');
    picture.type = 'button';
    picture.disabled = view;
    picture.title = gt('Picture');
    picture.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePictureChooser();
    });
    basics.appendChild(place(picture, 210, 34, 130, 119));

    // ---- pnlDesignWarningsBackground (370, 71) 410 × 170 → pnlDesignWarningsContainer (8, 8) 395 × 150 ---------------
    const warningsBack = at(editorPanel(10), 370, 71, 410, 170);
    body.appendChild(warningsBack);
    const warnings = place(scrollPanel('dsgx-warnings'), 8, 8, 395, 150);
    warningsBack.appendChild(warnings);

    // ---- pnlDesignEnergy (790, 71) 210 × 170 ------------------------------------------------------------------------
    const energy = at(editorPanel(20), 790, 71, 210, 170);
    body.appendChild(energy);

    // ---- Components ------------------------------------------------------------------------------------------------
    // chkDesignComponentsShowLatest (10, 249).
    body.appendChild(at(checkBox(gt('Only Show Latest Components'), false, null, SMALL), 10, 249));
    (body.lastElementChild as HTMLElement).title = 'Not available yet: every researched component is listed';
    // Our family filter over the toolbox.
    const categories = [...new Set(designToolboxComponents(empire).map((c) => c.category))].sort((a, b) => a - b);
    let categoryFilter = -1;
    const family = dropDown(
        [{ value: '-1', label: gt('All') }, ...categories.map((c) => ({ value: String(c), label: resolveComponentCategoryDescription(c) }))],
        '-1',
        (v) => {
            categoryFilter = Number(v);
            bindToolbox();
        },
        'Component family',
    );
    family.style.fontSize = `${SMALL}px`;
    body.appendChild(at(family, 215, 246, 115, 20));

    const supplied = new Set(determineResourcesEmpireSupplies(empire));
    const resourceName = (id: number): string => galaxy.resourceSystem?.resources[id]?.name ?? String(id);
    // ctlDesignComponentToolbox (10, 269) 320 × 278: Picture 35, Name 210, Category 35, Size 50 (TechPoints hidden).
    const toolbox = new OwGrid<ComponentDefinition>({
        key: (c) => c,
        onSelect: (c) => showComponent(c),
        onDoubleClick: (c) => add(c, 1),
        columns: [
            { id: 'Picture', header: '', width: 35, render: (c, cell) => cell.appendChild(componentPicture(c)) },
            {
                id: 'Name', header: gt('Name'), sort: (c) => c.name,
                render: (c, cell) => {
                    cell.textContent = c.name;
                    cell.classList.add('dsgx-link');
                    const missing = missingComponentResources(c, supplied, resourceName);
                    if (missing !== null) {
                        cell.classList.add('dsgx-missing');
                        cell.title = missing;
                    }
                },
            },
            {
                id: 'Category', header: gt('Category'), width: 35, sort: (c) => componentCategoryAbbreviation(c.category),
                render: (c, cell) => {
                    cell.textContent = componentCategoryAbbreviation(c.category);
                    cell.title = resolveComponentCategoryDescription(c.category);
                },
            },
            { id: 'Size', header: gt('Size'), width: 50, align: 'right', sort: (c) => c.size, render: (c, cell) => { cell.textContent = String(c.size); } },
        ],
    });
    body.appendChild(at(toolbox.el, 10, 269, 320, 278));

    // The add / remove buttons between the lists (Main.Part8.cs:252-265).
    const addMany = at(glassButton('>\nx5', { onClick: () => { const c = toolbox.selected; if (c) add(c, 5); }, size: FONT.normal }), 335, 269, 30, 45);
    const addOne = at(glassButton('>', { onClick: () => { const c = toolbox.selected; if (c) add(c, 1); }, size: FONT.large }), 335, 316, 30, 90);
    const removeOne = at(glassButton('<', { onClick: () => { const s = components.selected; if (s) remove(s.component, 1); }, size: FONT.large }), 335, 414, 30, 90);
    const removeMany = at(glassButton('<\nx5', { onClick: () => { const s = components.selected; if (s) remove(s.component, 5); }, size: FONT.normal }), 335, 507, 30, 45);
    for (const b of [addMany, addOne, removeOne, removeMany]) {
        b.disabled = view;
        b.classList.add('dsgx-arrow');
    }
    body.append(addMany, addOne, removeOne, removeMany);

    // pnlDesignComponentsHighlight (366, 269) 329 × 285, (128, 16, 80); lblDesignName (370, 275) + txtDesignName (415, 275).
    body.appendChild(at(el('div', 'dsgx-highlight'), 366, 269, 329, 285));
    body.appendChild(at(text(gt('Name'), { size: FONT.large, bold: true, color: '#fff' }), 370, 275));
    const name = textBox(design.name, gt('Name'), (v) => {
        design.name = v;
        updateTitle();
    });
    name.disabled = view;
    name.style.fontSize = `${FONT.large}px`;
    name.style.fontWeight = 'bold';
    // txtDesignName_Leave: refresh the warnings with the new name.
    name.addEventListener('change', () => refresh());
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    body.appendChild(at(name, 415, 273, 275, 22));
    // ctlDesignComponents (370, 299) 320 × 250, summarized: Picture 35, Amount 30, Name 210, Size 45 (Category hidden).
    type Summary = { component: ComponentDefinition; count: number };
    const components = new OwGrid<Summary>({
        key: (s) => s.component.componentId,
        onSelect: (s) => showComponent(s.component),
        onDoubleClick: (s) => remove(s.component, 1),
        columns: [
            { id: 'Picture', header: '', width: 35, render: (s, cell) => cell.appendChild(componentPicture(s.component)) },
            { id: 'Amount', header: gt('Amount'), width: 30, align: 'center', sort: (s) => s.count, render: (s, cell) => { cell.textContent = String(s.count); } },
            { id: 'Name', header: gt('Name'), sort: (s) => s.component.name, render: (s, cell) => { cell.textContent = s.component.name; cell.classList.add('dsgx-link'); } },
            { id: 'Size', header: gt('Size'), width: 45, align: 'right', sort: (s) => s.component.size * s.count, render: (s, cell) => { cell.textContent = String(s.component.size * s.count); } },
        ],
    });
    body.appendChild(at(components.el, 370, 299, 320, 250));

    // btnDesignsShowComponentGuide (10, 555), btnDesignsShowConstructionSummary (370, 555), 320 × 25.
    body.appendChild(at(glassButton(gt('Show Component Guide'), { disabled: true, title: 'Not available yet' }), 10, 555, 320, 25));
    body.appendChild(at(glassButton(gt('Show Construction Summary'), { disabled: true, title: 'Not available yet' }), 370, 555, 320, 25));

    // pnlDesignMovement (700, 249) 300 × 188, pnlDesignIndustry (700, 445) 300 × 132.
    const movement = at(editorPanel(20), 700, 249, 300, 188);
    const industry = at(editorPanel(20), 700, 445, 300, 132);
    body.append(movement, industry);

    // ---- Bottom row: pnlDesignComponentDetail (10, 585) 210 × 190, pnlDesignWeapons (230, 585) 550 × 190,
    //      pnlDesignDefense (790, 585) 210 × 190 ------------------------------------------------------------------------
    const detail = at(editorPanel(20), 10, 585, 210, 190);
    const weapons = at(editorPanel(20), 230, 585, 550, 190);
    const defense = at(editorPanel(20), 790, 585, 210, 190);
    body.append(detail, weapons, defense);
    dropText(weapons, gt('Weapons'), 10, 10, { size: FONT.large, bold: true, color: GREY });
    dropText(weapons, gt('Maximum Weapons Energy use per second'), 80, 10, { size: SMALL, color: GREY });
    const weaponsEnergy = dropText(weapons, '0', 310, 8, { size: SMALL, bold: true, color: GREY });
    // ctlDesignWeapons (10, 35) 330 × 145: Picture 35, Name 145, DamageGraph 150, rows 17.
    type WRow = ReturnType<typeof designWeaponRows>[number];
    const weaponGrid = new OwGrid<WRow & { i: number }>({
        key: (w) => w.i,
        rowHeight: 17,
        fontSize: SMALL,
        columns: [
            { id: 'Picture', header: '', width: 35, render: (w, cell) => cell.appendChild(componentPicture(w.component)) },
            { id: 'Name', header: gt('Name'), sort: (w) => w.name, render: (w, cell) => { cell.textContent = w.name; } },
            {
                id: 'DamageGraph', header: gt('Damage'), width: 150, sort: (w) => w.rawDamage,
                render: (w, cell) => {
                    cell.title = w.tooltip;
                    const pts = w.polygon.map((p) => `${p.x},${p.y}`).join(' ');
                    cell.insertAdjacentHTML('beforeend', `<svg class="dsgx-graph" viewBox="0 0 150 17" width="150" height="17" aria-hidden="true"><polygon points="${pts}"/></svg>`);
                },
            },
        ],
    });
    weapons.appendChild(place(weaponGrid.el, 10, 35, 330, 145));
    const weaponSummary = place(el('div', 'dsgx-weapon-summary'), 340, 0, 210, 190);
    weapons.appendChild(weaponSummary);

    // ---- Picture chooser (our layout of cmbDesignsPicture's drop-down: one ship family at a time) --------------------
    function togglePictureChooser(): void {
        if (pictureChooser !== null) {
            pictureChooser.remove();
            pictureChooser = null;
            return;
        }
        const groups = shipPictureGroups();
        const current = Math.max(0, Math.min(SHIP_PICTURE_COUNT - 1, design.pictureRef));
        let groupIndex = Math.max(0, groups.findIndex((g) => current >= g.first && current <= g.last));
        const box = at(editorPanel(10), 350, 34, 560, 520);
        box.classList.add('dsgx-chooser');
        box.addEventListener('pointerdown', (e) => e.stopPropagation());
        dropText(box, gt('Picture'), 12, 10, { size: FONT.large, bold: true, color: '#fff' });
        const famSel = dropDown(groups.map((g, i) => ({ value: String(i), label: g.label })), String(groupIndex), (v) => {
            groupIndex = Number(v);
            fill();
        });
        box.appendChild(place(famSel, 100, 9, 200, 22));
        const prev = glassButton('<', { onClick: () => { groupIndex = (groupIndex + groups.length - 1) % groups.length; famSel.value = String(groupIndex); fill(); } });
        const next = glassButton('>', { onClick: () => { groupIndex = (groupIndex + 1) % groups.length; famSel.value = String(groupIndex); fill(); } });
        box.append(place(prev, 308, 8, 30, 24), place(next, 342, 8, 30, 24));
        box.appendChild(place(glassButton(gt('Close'), { onClick: () => togglePictureChooser() }), 448, 8, 100, 24));
        const gridEl = place(scrollPanel('dsgx-chooser-grid'), 10, 40, 540, 470);
        box.appendChild(gridEl);
        function fill(): void {
            gridEl.replaceChildren();
            const g = groups[groupIndex];
            for (let i = g.first; i <= g.last; i++) {
                const url = builtObjectImageUrl(i);
                if (url === null) continue;
                const cell = el('button', `dsgx-chooser-cell${i === design.pictureRef ? ' dsgx-on' : ''}`);
                cell.type = 'button';
                cell.title = `#${i}`;
                const img = el('img');
                img.src = url;
                img.alt = '';
                img.draggable = false;
                cell.appendChild(img);
                cell.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // cmbDesignsPicture_SelectedIndexChanged → PrepareDesignForEditor: PictureRef = SelectedIndex.
                    design.pictureRef = i;
                    togglePictureChooser();
                    refresh();
                });
                gridEl.appendChild(cell);
            }
        }
        fill();
        body.appendChild(box);
        pictureChooser = box;
    }
    body.addEventListener('pointerdown', () => {
        if (pictureChooser !== null) togglePictureChooser();
    });

    // ---- Binding ---------------------------------------------------------------------------------------------------
    function componentPicture(c: ComponentDefinition): HTMLImageElement {
        const img = el('img', 'dsgx-component-pic');
        img.src = componentImageUrl(c.pictureRef);
        img.alt = '';
        img.draggable = false;
        return img;
    }

    function bindToolbox(): void {
        const all = designToolboxComponents(empire);
        toolbox.setRows(categoryFilter < 0 ? all : all.filter((c) => c.category === categoryFilter));
    }

    function add(c: ComponentDefinition, count: 1 | 5): void {
        if (view) return;
        if (addComponent(empire, draft, c, count).ok) {
            refresh();
            components.select(c.componentId);
            showComponent(c);
        }
    }

    function remove(c: ComponentDefinition, count: 1 | 5): void {
        if (view) return;
        if (removeComponent(draft, c, count).ok) {
            refresh();
            if (design.components.some((x) => x.componentId === c.componentId)) components.select(c.componentId);
        }
    }

    function updateTitle(): void {
        // OpenDesignEditor / txtDesignName_Leave.
        const t = view ? gt('View Design') : gt('Edit Design');
        setText(title, design.name !== '' ? `${t}: ${design.name}` : t);
    }

    /** ComponentDetail.DrawComponentDetailInfo for the selected component (SetTextPositions(5, 135, 150, 60)). */
    function showComponent(c: ComponentDefinition | null): void {
        detail.replaceChildren();
        if (c === null) return;
        const m = componentDetailModel(empire, c);
        const t = text(m.title, { size: FONT.normal + 2, bold: true, color: GREY });
        t.classList.add('dsgx-detail-title');
        detail.appendChild(place(t, 3, 12, 160));
        const pic = componentPicture(c);
        pic.classList.add('dsgx-detail-pic');
        detail.appendChild(place(pic, 210 - 10 - 40, 10, 40, 20));
        let y = 30 + 14;
        detail.appendChild(place(text(m.type, { size: 13, bold: true, color: GREY }), 5, y));
        y += 14;
        detail.appendChild(place(text(m.sizeCost, { size: 13, color: GREY }), 5, y));
        y += 14;
        if (m.energyUsed > 0) {
            const l = text(gt('Static Energy Used'), { size: 13, color: GREY });
            l.classList.add('ow-right');
            detail.append(place(l, 5 + 135, y), place(text(m.staticEnergy, { size: 13, bold: true, color: GREY }), 150, y - 2));
            y += 14;
        }
        for (const line of m.lines) {
            if (line.value === null) {
                const d = text(line.description, { size: 13, color: GREY, wrapWidth: 204 });
                detail.appendChild(place(d, 4, y));
                y += 14 * Math.max(1, Math.ceil(line.description.length / 30));
            } else {
                const l = text(line.description, { size: 13, color: GREY });
                l.classList.add('ow-right');
                detail.append(place(l, 5 + 135, y), place(text(line.value, { size: 13, bold: true, color: GREY }), 150, y - 1));
                y += 13;
            }
        }
    }

    function renderWarnings(): void {
        // DesignWarnings.DrawWarningInfo: "Warnings" title, then the red must-do and yellow should-do lines (bold).
        const { mustDo, shouldDo } = designWarnings(galaxy, empire, design);
        warnings.replaceChildren();
        const head = text(gt('Warnings'), { size: FONT.normal + 2, bold: true, color: GREY });
        head.style.position = 'static';
        warnings.appendChild(head);
        for (const [list, cls] of [[mustDo, 'dsgx-must'], [shouldDo, 'dsgx-should']] as const) {
            for (const w of list) {
                const line = text(resolveGameText(w), { size: FONT.normal, bold: true, wrapWidth: 375, className: cls });
                line.style.position = 'static';
                warnings.appendChild(line);
            }
        }
    }

    function renderEnergy(): void {
        // DesignEnergy.DrawEnergyInfo: x 8, label width 142, value x 160, rows 14 from y 30.
        energy.replaceChildren();
        dropText(energy, gt('Energy'), 8, 10, { size: FONT.normal + 2, bold: true, color: GREY });
        const m = designEnergyPanel(design, resourceName);
        let y = statRows(energy, m.top, 8, 142, 160, 30, 14);
        y += 14;
        dropText(energy, m.fuelType, 8, y, { color: GREY });
        y = statRows(energy, m.bottom, 8, 142, 160, y + 14, 14);
        dropText(energy, m.fuelPer1000, 8, y, { color: GREY });
    }

    function renderMovement(): void {
        // DesignMovement.DrawMovementInfo.
        movement.replaceChildren();
        dropText(movement, gt('Movement'), 8, 8, { size: FONT.normal + 2, bold: true, color: GREY });
        const m = designMovementPanel(design);
        if (!m.moving) {
            const t = text(`(${gt('No movement')})`, { bold: true, color: GREY });
            t.classList.add('dsgx-center');
            movement.appendChild(place(t, 0, 75, 300));
            return;
        }
        const { top, row } = MOVEMENT_ROWS;
        const y1 = top + row + 4;
        const y2 = top + row * 2 + 4;
        const y3 = top + row * 3 + 4;
        const num2 = top + row * 4 + 4;
        const num3 = top + row * 4 + 60 + 4;
        const y4 = top + row * 4 + 66 + 4;
        const y5 = top + row * 5 + 72 + 4;
        const fill = (cls: string, x: number, y: number, w: number, h: number): void => { movement.appendChild(place(el('div', cls), x, y, w, h)); };
        fill('dsgx-mv-band1', 10, y2, 280, y3 - y2);
        fill('dsgx-mv-band2', 10, y3, 280, num2 - y3);
        ['dsgx-mv-c0', 'dsgx-mv-c1', 'dsgx-mv-c2', 'dsgx-mv-c3'].forEach((cls, i) => fill(cls, MOVEMENT_COLUMNS[i].x, y1, MOVEMENT_COLUMNS[i].w, num3 - y1));
        const centered = (s: string, x: number, w: number, y: number, size: number = FONT.normal): void => {
            const t = text(s, { size, color: GREY });
            t.classList.add('dsgx-center');
            movement.appendChild(place(t, x, y, w));
        };
        const heads = [gt('Impulse'), gt('Cruise'), gt('Sprint'), gt('Hyper')];
        MOVEMENT_COLUMNS.forEach((c, i) => {
            centered(heads[i], c.x, c.w, y1);
            centered(String(Math.trunc(m.speeds[i])), c.x, c.w, y2);
            centered(String(Math.trunc(m.burns[i])), c.x, c.w, y3);
        });
        const right = (s: string, y: number): void => {
            const t = text(s, { color: GREY });
            t.classList.add('ow-right');
            movement.appendChild(place(t, 10 + 60 - 10, y));
        };
        right(gt('Speed Abbreviation'), y2);
        right(gt('Energy'), y3);
        centered(gt('Energy'), 10, 60, num2 + 15);
        centered(gt('Curve'), 10, 60, num2 + 30);
        const pts = m.curve.map((p) => `${p.x},${p.y}`).join(' ');
        const svg = `<svg class="dsgx-curve" viewBox="0 0 300 188" width="300" height="188" aria-hidden="true">`
            + `<line class="dsgx-static" x1="70" y1="${m.staticY}" x2="290" y2="${m.staticY}"/><polyline points="${pts}"/></svg>`;
        movement.insertAdjacentHTML('beforeend', svg);
        centered(gt('Static Energy Usage'), 70, 220, m.staticY + 1, FONT.normal - 2);
        dropText(movement, m.acceleration, 10, y4, { color: GREY });
        dropText(movement, m.turnRate, 160, y4, { color: GREY });
        dropText(movement, m.range, 10, y5, { color: GREY });
    }

    function renderIndustry(): void {
        // DesignIndustry.DrawIndustryInfo: label right-aligned in 90 from x 10, value at x 110 two pixels up, rows 13.
        industry.replaceChildren();
        dropText(industry, gt('Industry'), 8, 8, { size: FONT.normal + 2, bold: true, color: GREY });
        const m = designIndustryPanel(design);
        const ys = [28, 41, 54, 54 + 13 + 6, 54 + 26 + 6, 54 + 39 + 6, 54 + 52 + 6];
        m.rows.forEach((r, i) => statRows(industry, [r], 10, 90, 110, ys[i], 13, 2));
        // Recreation on the Medical row's right half (Width / 2 + 10).
        dropText(industry, m.recreation.label, 10 + 160, ys[1], { color: GREY });
        const recValue = dropText(industry, m.recreation.value, 0, ys[1] - 2, { bold: true, color: GREY });
        recValue.style.left = 'auto';
        recValue.style.right = '8px';
    }

    function renderDefense(): void {
        // DesignDefense.DrawDefenseInfo: x 10, label width 140, value x 160, rows 14 from y 25.
        defense.replaceChildren();
        dropText(defense, gt('Defense'), 10, 10, { size: FONT.normal + 2, bold: true, color: GREY });
        statRows(defense, designDefenseRows(design, empire.dominantRace), 10, 140, 160, 25, 14);
    }

    function renderWeapons(): void {
        weaponGrid.setRows(designWeaponRows(design).map((w, i) => ({ ...w, i })));
        // The right column: labels end near x 475, values at 480 (Main.Part8.cs:310-337), 15 px rows from y 4.
        weaponSummary.replaceChildren();
        let y = 4;
        for (const r of designWeaponSummary(design, empire)) {
            const l = text(r.label, { size: SMALL, color: GREY });
            l.classList.add('ow-right');
            weaponSummary.append(place(l, 475 - 340, y), place(text(r.value, { size: SMALL, bold: true, color: GREY }), 480 - 340, y));
            y += 15;
        }
        setText(weaponsEnergy, String(Math.round(calculateTotalWeaponsEnergyUsePerSecond(design, empire.research))));
    }

    // method_292 (+ method_385): everything that depends on the design.
    function refresh(): void {
        updateTitle();
        setText(purchase, `${gt('Purchase Cost')}: ${Math.round(design.calculateCurrentPurchasePrice(galaxy))}`);
        setText(maintenance, `${gt('Maintenance Cost')}: ${Math.round(designCalculateMaintenanceCosts(galaxy, design, (design.empire as Empire | null) ?? empire))}`);
        setText(sizeValue, String(design.size));
        setSelect(subRole, design.subRole);
        setSelect(stronger, design.tacticsStrongerShips);
        setSelect(weaker, design.tacticsWeakerShips);
        setSelect(invasion, design.tacticsInvasion);
        setSelect(flee, design.fleeWhen);
        retrofit.value = design.allowAutoRetrofit ? '1' : '0';
        // cmbDesignDetailAutoRetrofit.Enabled = false for the six private sub-roles.
        retrofit.disabled = view || isPrivateDesignSubRole(design.subRole);
        setText(explanation, design.subRole === BuiltObjectSubRole.Undefined ? '' : resolveGameText(designUpgradeExplanation(empire, design)));
        const url = builtObjectImageUrl(design.pictureRef);
        const img = picture.querySelector('img');
        if (url === null) picture.replaceChildren();
        else if (img === null || img.getAttribute('src') !== url) {
            const i = el('img');
            i.src = url;
            i.alt = '';
            i.draggable = false;
            picture.replaceChildren(i);
        }
        components.setRows(summarizeComponents(design));
        renderWarnings();
        renderEnergy();
        renderMovement();
        renderIndustry();
        renderDefense();
        renderWeapons();
    }

    // btnDesignsSaveDesign_Click (Main.Part6.cs:164) through the command log; a refusal shows the original's message.
    let saving = false;
    function save(): void {
        if (saving) return;
        design.name = name.value;
        saving = true;
        issuePlayerCommand(galaxy, empire, 'saveDesign', [draft], (r) => {
            saving = false;
            if (win.closed) return;
            if (!r.ok) {
                refresh();
                void messageBox({ caption: resolveGameText(r.title ?? ''), text: resolveGameText(r.message ?? ''), icon: 'warning' });
                return;
            }
            saved = r.design;
            win.close();
        });
    }

    for (const s of [subRole, stronger, weaker, invasion, flee, scaling]) s.disabled = view;
    setScalingMode(design.imageScalingType, true);
    bindToolbox();
    refresh();
    if (view) {
        // Main.Part7.cs:4881-4886: an in-use design opens in View mode with this message.
        void messageBox({ caption: gt('Cannot edit this design'), text: gt('You cannot edit this design because it is already in use'), icon: 'information' });
    } else name.focus();
    return { close: () => win.close() };
}
