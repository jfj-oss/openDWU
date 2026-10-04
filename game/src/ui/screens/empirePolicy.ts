// Empire Policy panel (task 17d): the player's automation levels and EmpirePolicy settings, opened by the top-bar
// Empire Policy button (Main.Part2.cs:1184 btnEmpirePolicy_Click toggles method_595 / method_596; the original has
// no hotkey for it). Rows, groups, value ranges and read-back conversions are the original's
// (empirePolicyModel.ts: method_609 fill, method_597 apply). The window is the original's pnlEmpirePolicy (Main.Part3.cs
// method_595: ScreenPanel 965 × 760, pnlEmpirePolicyContainer (10, 10) 930 × 635 scrolling, (32, 32, 32), holding
// pnlEmpirePolicyPanel 910 wide) with method_609's layout: header bands (method_611), automation combos on the band
// (method_622), rows of label / control / suffix at 25 px (method_626), the explanation paragraph (method_612) and the
// Load / Save buttons along the bottom. Streamlined: every change is applied at once through the method_597 mapping (the
// original applies on OK), so there is no Apply Policy / Cancel pair; and a section list on the left (ours) jumps to a
// band. Load / Save (Main.Part3.cs:3807 btnEmpirePolicyLoad_Click / 3859
// btnEmpirePolicySave_Click): the install's Policy/ files (read-only) and the player's own files in browser storage
// (../policyFiles.ts), in EmpirePolicy.cs's file format (sim/data/policies.ts writeEmpirePolicyFile / loadEmpirePolicyFile),
// listed in an original-style window in place of the OpenFileDialog / SaveFileDialog.
// GameOptions persistence: every apply saves the Control*Default fields and the design-upgrade flags into the new-game
// defaults (Main.Part3.cs:4179-4198), a load the design-upgrade flags (Main.Part3.cs:3840); settings.newGameOptions.

import './empirePolicy.css';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { Design } from '../../sim/design';
import { resolveSubRoleDescription } from '../../sim/designGeneration';
import { builtObjectImageUrl, resolveDrawPictureRef } from '../../render/builtObjectLayer';
import { empireFlagUrl } from '../selectionInfoView';
import {
    checkBox,
    dropDown,
    el,
    FONT,
    glassButton,
    imageCombo,
    numericUpDown,
    openOriginalWindow,
    OwGrid,
    place,
    scrollPanel,
    text as owText,
    textBox,
    type ImageComboItem,
    type OriginalWindow,
} from '../originalWindow';
import { planetaryFacilityDefinitionsStatic } from '../../sim/construction/facilities';
import { defaultEmpirePolicy, loadEmpirePolicyFile, writeEmpirePolicyFile } from '../../sim/data/policies';
import { MANIFEST } from '../../render/assets';
import { policyFileEntries, policyFileName, readPolicyFileEntry, savedPolicyFiles, writeSavedPolicyFile, type PolicyFileEntry } from '../policyFiles';
import { showToast } from '../toast';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { PendingValues } from '../pendingCommands';
import { getSettings, updateSettings } from '../settings';
import { gameOptionsAfterPolicyApply } from './gameOptionsModel';
import {
    applyPolicyPanel,
    buildPolicyPanel,
    issuePolicyPanel,
    clampNumeric,
    designLabel,
    type DesignControl,
    panelControls,
    policyText,
    type ComboControl,
    type PolicyControl,
    type PolicyPanelContext,
    type PolicyRow,
    type PolicySection,
} from './empirePolicyModel';

export interface EmpirePolicyOptions {
    /** galaxy.playerEmpire (method_595 edits _Game.PlayerEmpire). */
    empire: Empire;
}

interface OpenState {
    win: OriginalWindow;
    close: () => void;
}

let open: OpenState | null = null;

/** Open the Empire Policy panel, or close it if it is already open (btnEmpirePolicy_Click). */
export function toggleEmpirePolicy(opts: EmpirePolicyOptions): void {
    if (open) open.close();
    else open = createEmpirePolicy(opts);
}

/** Close the panel (no-op when closed). */
export function closeEmpirePolicy(): void {
    open?.close();
}

export function isEmpirePolicyOpen(): boolean {
    return open !== null;
}

// --- Layout (Main.Part3.cs:3910 method_595 and Main.Part2.cs method_609-626, original pixels) ---------------------------
/** Our section list, left of the original's container (the window grows by its width). */
const NAV = { x: 10, y: 10, w: 200, h: 635 };
/** pnlEmpirePolicyContainer (10, 10) 930 × 635, moved right of the section list. */
const CONTAINER = { x: NAV.x + NAV.w + 10, y: 10, w: 930, h: 635 };
/** pnlEmpirePolicy 965 × 760 plus the section list. */
const WIN = { w: 965 + NAV.w + 10, h: 760 };
/** pnlEmpirePolicyPanel width (nDrsqatloR.Size 910 × …). */
const PANEL_W = 910;
/** method_609: int_ = 350 (the label column; ours 420 so the longer labels fit the game font on one line), num2 = 715
 *  (the automation combo's x; a second one at num2 - 200). */
const LABEL_W = 420;
const AUTO_X = 715;
const AUTO_W = 190;
/** method_626 control widths: combos / DesignDropDown 250, NumericUpDown 55 (ours 70: the spinner buttons take 16),
 *  CheckBox 25. */
const CONTROL_W = { combo: 250, design: 250, numeric: 70, check: 25 } as const;
/** method_610 / method_624-626: the row pitch. */
const ROW_H = 25;
/** btnEmpirePolicyLoad / Save: 110 × 30 at (num + 400 / num + 520, 656), num = (965 - 630) / 2. */
const BUTTONS_Y = 656;
const LOAD_X = CONTAINER.x - 10 + (965 - 630) / 2 + 400;
/** Panel text (font_6) and the band title (font_2, (220, 220, 220)). */
const TEXT_COLOR = 'rgb(170, 170, 170)';

function createEmpirePolicy(opts: EmpirePolicyOptions): OpenState {
    const empire = opts.empire;
    const galaxy = empire.galaxy;
    const ctx: PolicyPanelContext = { facilities: planetaryFacilityDefinitionsStatic(galaxy) };
    const sections: PolicySection[] = buildPolicyPanel(empire, empire.policy ?? defaultEmpirePolicy(), ctx);
    const controls = panelControls(sections);
    const playerIsPirate = (galaxy.playerEmpire ?? empire).pirateEmpireBaseHabitat !== null;

    // The automation values this panel sent, until their replies land (pendingCommands.ts): a change X → Y → X within
    // one reply still sends the X (in sim-worker mode the replica shows a change a round trip later).
    const sentControls = new PendingValues<string, unknown>();
    // Main.Part2.cs WqesexberY_Click: _Game.PlayerEmpire.Policy = method_597(panel, PlayerEmpire) — run on every change.
    const apply = (): void => {
        const issued = issuePolicyPanel(empire, playerIsPirate, controls, ctx, sentControls);
        // Main.Part3.cs:4179-4198: gameOptions_0.Control*Default = the empire's, ApplyDesignUpgradePoliciesToGameOptions.
        updateSettings({ newGameOptions: gameOptionsAfterPolicyApply(getSettings().newGameOptions, empire, issued.policy, issued.automation) });
    };

    let picker: OriginalWindow | null = null;
    const closePicker = (): void => {
        picker?.close();
        picker = null;
    };
    const win = openOriginalWindow({
        id: 'empirePolicy',
        title: policyText('Empire Policy'),
        icon: 'empirePolicy.png',
        width: WIN.w,
        height: WIN.h,
        onClose: () => {
            closePicker();
            if (open !== null && open.win === win) open = null;
        },
    });
    // Hooks kept from the earlier DOM (scripts find the screen and its controls by them).
    win.frame.classList.add('policy-window');
    win.frame.querySelector('.ow-close')?.classList.add('policy-close');
    const state: OpenState = { win, close: () => win.close() };
    const body = win.body;

    // pnlEmpirePolicyContainer: AutoScroll, (32, 32, 32); the panel inside holds method_609's controls.
    const container = place(scrollPanel('ep-container'), CONTAINER.x, CONTAINER.y, CONTAINER.w, CONTAINER.h);
    const panel = place(el('div', 'ep-panel'), 0, 0, PANEL_W);
    container.appendChild(panel);
    body.appendChild(container);

    // Port of method_609's layout pass: y starts at 5; a 25 px gap (method_610) before every band but the first
    // (the pirate layout starts with one, Main.Part3.cs:4590).
    const bandTops: number[] = [];
    let y = 5;
    sections.forEach((s, i) => {
        if (i > 0 || playerIsPirate) y += ROW_H;
        // method_622 (the band's automation combos at num2, the first of two at num2 - 200), then method_611.
        const band = place(el('div', 'ep-band policy-band'), 0, y - 4, PANEL_W, 34);
        band.id = `policy-section-${i}`;
        band.appendChild(place(owText(s.title, { size: FONT.header, bold: true, color: 'rgb(220, 220, 220)', shadow: false, className: 'ep-band-title policy-band-title' }), 5, 5, AUTO_X - 200 - 15));
        const autos = place(el('div', 'policy-band-auto'), 0, 0, PANEL_W, 34);
        s.automation.forEach((a, k) => {
            const x = AUTO_X - 200 * (s.automation.length - 1 - k);
            autos.appendChild(place(comboElement(a.control, apply), x, 4, AUTO_W, 22));
        });
        band.appendChild(autos);
        panel.appendChild(band);
        bandTops.push(y - 4);
        y += 35;
        for (const r of s.rows) {
            if (r.note !== undefined) {
                // method_610 + method_612: the explanation label across the panel, as tall as its text.
                y += ROW_H;
                const note = place(owText(r.note, { size: FONT.large, color: TEXT_COLOR, shadow: false, wrapWidth: PANEL_W, className: 'ep-explanation policy-explanation' }), 0, y);
                panel.appendChild(note);
                y += Math.ceil(note.offsetHeight) + 2;
            }
            panel.appendChild(rowElement(r, y, galaxy, apply));
            y += ROW_H;
        }
    });
    panel.style.height = `${y + ROW_H}px`;

    // Our section list: a ListViewBase grid of the band titles; a click scrolls the container to the band, scrolling
    // the container moves the selection along.
    const nav = new OwGrid<{ i: number; title: string }>({
        columns: [{ id: 'title', header: '', fill: 1, render: (r, c) => void (c.textContent = r.title) }],
        key: (r) => r.i,
        headers: false,
        rowHeight: 24,
        onSelect: (r) => {
            container.scrollTop = bandTops[r.i];
        },
    });
    nav.el.classList.add('ep-nav', 'policy-nav');
    nav.setRows(sections.map((s, i) => ({ i, title: s.title })));
    nav.setSelection([0]);
    body.appendChild(place(nav.el, NAV.x, NAV.y, NAV.w, NAV.h));
    container.addEventListener('scroll', () => {
        let cur = 0;
        for (let i = 0; i < bandTops.length; i++) if (bandTops[i] <= container.scrollTop + 2) cur = i;
        nav.setSelection([cur]);
    });

    // ---- Load / Save (btnEmpirePolicyLoad / btnEmpirePolicySave: the OpenFileDialog / SaveFileDialog on Policy/) ----
    const loadBtn = glassButton('Load...', { className: 'policy-file-button policy-load', title: policyText('Load Distant Worlds empire policy'), onClick: () => openLoad() });
    const saveBtn = glassButton('Save as...', { className: 'policy-file-button policy-save', title: policyText('Save Distant Worlds empire policy'), onClick: () => openSave() });
    body.append(place(loadBtn, LOAD_X, BUTTONS_Y, 110, 30), place(saveBtn, LOAD_X + 120, BUTTONS_Y, 110, 30));

    /** A file dialog as a small ScreenPanel over the policy window (Escape / its close button / Cancel close it). */
    const openPicker = (title: string): OriginalWindow => {
        closePicker();
        const p = openOriginalWindow({
            id: 'empirePolicyFile',
            title,
            icon: 'empirePolicy.png',
            width: 520,
            height: 560,
            onClose: () => {
                if (picker === p) picker = null;
            },
        });
        p.frame.classList.add('policy-file-picker');
        picker = p;
        return p;
    };

    function loadEntry(entry: PolicyFileEntry): void {
        void readPolicyFileEntry(entry).then(
            (text) => {
                // EmpirePolicy.LoadFromFile on the player's policy, then method_595 re-binds the panel.
                const policy = loadEmpirePolicyFile(empire.policy ?? defaultEmpirePolicy(), text);
                // Main.Part3.cs:3840 Galaxy.ApplyDesignUpgradePoliciesToGameOptions(gameOptions_0, Policy): the flags only.
                updateSettings({ newGameOptions: gameOptionsAfterPolicyApply(getSettings().newGameOptions, empire, policy, null) });
                issuePlayerCommand(galaxy, empire, 'setPolicy', [policy], () => {
                    if (open !== state) return;
                    state.close();
                    open = createEmpirePolicy(opts);
                });
                closePicker();
            },
            () => showToast(`Cannot read ${entry.name}`),
        );
    }

    function openLoad(): void {
        const p = openPicker(policyText('Load Distant Worlds empire policy'));
        const W = p.bodySize.w;
        const H = p.bodySize.h;
        p.body.appendChild(place(owText(`${policyText('Distant Worlds empire policy files')} (*.txt)`, { size: FONT.normal, color: TEXT_COLOR, shadow: false }), 10, 8));
        const grid = new OwGrid<PolicyFileEntry>({
            columns: [
                { id: 'name', header: policyText('Name'), fill: 1, sort: (e) => e.name, render: (e, c) => void (c.textContent = e.name), title: '' },
                { id: 'source', header: policyText('Location'), width: 150, sort: (e) => e.source, render: (e, c) => void (c.textContent = e.source === 'saved' ? 'Saved in this browser' : 'Policy folder') },
            ],
            key: (e) => `${e.source}:${e.name}`,
            rowHeight: 22,
            empty: `(${policyText('None')})`,
            rowClass: (e) => `policy-file-entry policy-file-${e.source}`,
            onSelect: () => (ok.disabled = false),
            onDoubleClick: (e) => loadEntry(e),
        });
        grid.setRows(policyFileEntries(MANIFEST));
        p.body.appendChild(place(grid.el, 10, 32, W - 20, H - 32 - 50));
        const ok = glassButton('Load', {
            className: 'policy-file-ok',
            disabled: true,
            onClick: () => {
                const e = grid.selected;
                if (e !== null) loadEntry(e);
            },
        });
        const cancel = glassButton('Cancel', { onClick: closePicker });
        p.body.append(place(ok, W - 250, H - 40, 115, 30), place(cancel, W - 125, H - 40, 115, 30));
    }

    function openSave(): void {
        const p = openPicker(policyText('Save Distant Worlds empire policy'));
        const W = p.bodySize.w;
        const H = p.bodySize.h;
        p.body.appendChild(place(owText(policyText('File name'), { size: FONT.normal, color: TEXT_COLOR, shadow: false }), 10, 12));
        const input = textBox('MyPolicy.txt', '', () => {});
        input.classList.add('policy-file-name');
        p.body.appendChild(place(input, 110, 8, W - 120, 25));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') save();
        });
        // The files already saved in this browser (a click takes the name, a double click saves over it).
        const existing = savedPolicyFiles();
        const grid = new OwGrid<string>({
            columns: [{ id: 'name', header: 'Saved in this browser', fill: 1, sort: (n) => n, render: (n, c) => void (c.textContent = n) }],
            key: (n) => n,
            rowHeight: 22,
            empty: `(${policyText('None')})`,
            rowClass: () => 'policy-file-existing',
            onSelect: (n) => (input.value = n),
            onDoubleClick: (n) => {
                input.value = n;
                save();
            },
        });
        grid.setRows(existing);
        p.body.appendChild(place(grid.el, 10, 42, W - 20, H - 42 - 50));
        const ok = glassButton('Save', { className: 'policy-file-ok', onClick: () => save() });
        const cancel = glassButton('Cancel', { onClick: closePicker });
        p.body.append(place(ok, W - 250, H - 40, 115, 30), place(cancel, W - 125, H - 40, 115, 30));
        input.focus();
        input.select();
        function save(): void {
            const name = policyFileName(input.value);
            if (name === '') return;
            // `PlayerEmpire.Policy = method_597(panel)` (as OK), then SaveToFile.
            const policy = applyPolicyPanel(empire, playerIsPirate, controls, ctx, () => {});
            apply();
            if (writeSavedPolicyFile(name, writeEmpirePolicyFile(policy))) showToast(`Saved ${name}`);
            else showToast('Browser storage is not available: the policy was not saved');
            closePicker();
        }
    }
    return state;
}

/** method_622 / method_616-621: a DropDownList ComboBox, (51, 51, 51) / (170, 170, 170). */
function comboElement(c: ComboControl, onChange: () => void): HTMLSelectElement {
    const sel = dropDown(
        c.options.map((o, i) => ({ value: String(i), label: o })),
        String(c.index),
        (v) => {
            c.index = Number(v);
            onChange();
        },
    );
    sel.classList.add('policy-select');
    // WinForms SelectedIndex -1 (the fill left no selection): an empty box.
    if (c.index < 0) sel.selectedIndex = -1;
    return sel;
}

/** DesignDropDown.OnDrawItem: the design empire's flag at x 3 (not the independents'), the small ship picture at x 30,
 *  "<sub-role> (<name>)" at x 49; "(None)" first (allowNullDesign). */
function designCombo(c: DesignControl, galaxy: Galaxy, readOnly: boolean, onChange: () => void): HTMLDivElement {
    const items: ImageComboItem[] = [{ value: '0', label: designLabel(null) }];
    c.designs.forEach((x, i) => {
        const d = x as Design;
        const flag = d.empire != null && d.empire !== galaxy.independentEmpire ? empireFlagUrl(galaxy, d.empire as Empire).catch(() => null) : null;
        items.push({
            value: String(i + 1),
            label: `${resolveSubRoleDescription(d.subRole)} (${d.name})`,
            pictures: [
                ...(flag !== null ? [{ url: flag, x: 3 }] : []),
                { url: builtObjectImageUrl(resolveDrawPictureRef({ pictureRef: d.pictureRef, isPlanetDestroyer: false, subRole: d.subRole, builtObjectID: 0 })), x: 30, square: true, rotate: 90 },
            ],
        });
    });
    const at = c.design === null ? 0 : c.designs.indexOf(c.design) + 1;
    const combo = imageCombo({
        items,
        value: String(Math.max(0, at)),
        textX: 49,
        size: FONT.normal,
        maxItems: 12,
        onChange: (v) => {
            const i = Number(v);
            c.design = i === 0 ? null : (c.designs[i - 1] ?? null);
            c.label = designLabel(c.design);
            onChange();
        },
    });
    combo.el.classList.add('policy-select', 'policy-design');
    if (readOnly) combo.el.classList.add('ow-disabled');
    return combo.el;
}

function controlElement(c: PolicyControl, readOnly: boolean, galaxy: Galaxy, onChange: () => void): { el: HTMLElement; w: number; dy: number; h: number } {
    switch (c.kind) {
        case 'combo':
            return { el: comboElement(c, onChange), w: CONTROL_W.combo, dy: -2, h: 22 };
        case 'check': {
            const box = checkBox('', c.checked, (v) => {
                c.checked = v;
                onChange();
            });
            box.querySelector('input')?.classList.add('policy-check');
            return { el: box, w: CONTROL_W.check, dy: -1, h: 20 };
        }
        case 'numeric': {
            // NumericUpDown keeps the value inside Minimum..Maximum (method_625). Typed digits are applied when the box
            // commits (Enter / leaving it), the arrows and the wheel at once.
            let typing = false;
            let dirty = false;
            const spin = numericUpDown({
                value: c.value,
                min: c.min,
                max: c.max,
                size: FONT.normal,
                align: 'left',
                onChange: (v) => {
                    c.value = clampNumeric(v, c.min, c.max);
                    if (typing) {
                        typing = false;
                        dirty = true;
                        return;
                    }
                    dirty = false;
                    onChange();
                },
            });
            spin.el.classList.add('policy-number');
            // Capture runs before the box's own input listener (which raises onChange), the bubble listener after it.
            spin.el.addEventListener('input', () => (typing = true), true);
            spin.el.addEventListener('input', () => (typing = false));
            spin.input.addEventListener('change', () => {
                if (!dirty) return;
                dirty = false;
                onChange();
            });
            return { el: spin.el, w: CONTROL_W.numeric, dy: -2, h: 22 };
        }
        case 'design':
            return { el: designCombo(c, galaxy, readOnly, onChange), w: CONTROL_W.design, dy: -2, h: 22 };
    }
}

/** method_626: the label right-aligned in the label column, the control at 352 (a little higher for combos and
 *  numbers), the suffix label after the control — or, longer than 30 characters on a combo, its tooltip. */
function rowElement(r: PolicyRow, y: number, galaxy: Galaxy, onChange: () => void): HTMLElement {
    const line = place(el('div', 'ep-row policy-row'), 0, y, PANEL_W, ROW_H);
    const label = place(owText(r.label, { size: FONT.large, color: TEXT_COLOR, shadow: false, className: 'ep-label policy-label' }), 0, 0, LABEL_W);
    label.title = r.label;
    line.appendChild(label);
    const ctl = controlElement(r.control, r.readOnly === true, galaxy, onChange);
    line.appendChild(place(ctl.el, LABEL_W + 2, ctl.dy, ctl.w, ctl.h));
    if (r.readOnly) {
        line.classList.add('policy-row-readonly');
        line.title = 'Not yet available';
    }
    if (r.suffix !== '') {
        if (r.suffix.length > 30 && (r.control.kind === 'combo' || r.control.kind === 'design')) ctl.el.title = r.suffix;
        else line.appendChild(place(owText(r.suffix, { size: FONT.large, color: TEXT_COLOR, shadow: false, className: 'ep-suffix policy-suffix' }), LABEL_W + 2 + ctl.w, 0, 300));
    }
    return line;
}
