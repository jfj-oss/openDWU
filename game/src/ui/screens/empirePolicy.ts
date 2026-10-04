// Empire Policy panel (task 17d): the player's automation levels and EmpirePolicy settings, opened by the top-bar
// Empire Policy button (Main.Part2.cs:1184 btnEmpirePolicy_Click toggles method_595 / method_596; the original has
// no hotkey for it). Rows, groups, value ranges and read-back conversions are the original's
// (empirePolicyModel.ts: method_609 fill, method_597 apply). Streamlined: one scrolling column of the original's
// header bands with their automation combos on the band, and every change is applied at once through the
// method_597 mapping (the original applies on OK). Load / Save (Main.Part3.cs:3807 btnEmpirePolicyLoad_Click / 3859
// btnEmpirePolicySave_Click): the install's Policy/ files (read-only) and the player's own files in browser storage
// (../policyFiles.ts), in EmpirePolicy.cs's file format (sim/data/policies.ts writeEmpirePolicyFile / loadEmpirePolicyFile).
// TODO(port): Galaxy.ApplyDesignUpgradePoliciesToGameOptions after a load (Main.Part3.cs:3840) — GameOptions persistence.

import './empirePolicy.css';
import type { Empire } from '../../sim/empire';
import { planetaryFacilityDefinitionsStatic } from '../../sim/construction/facilities';
import { defaultEmpirePolicy, loadEmpirePolicyFile, writeEmpirePolicyFile } from '../../sim/data/policies';
import { MANIFEST } from '../../render/assets';
import { policyFileEntries, policyFileName, readPolicyFileEntry, savedPolicyFiles, writeSavedPolicyFile } from '../policyFiles';
import { showToast } from '../toast';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import {
    applyPolicyPanel,
    buildPolicyPanel,
    policyAutomationChange,
    type PolicyAutomationChange,
    clampNumeric,
    designLabel,
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
    root: HTMLElement;
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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

function createEmpirePolicy(opts: EmpirePolicyOptions): OpenState {
    const empire = opts.empire;
    const galaxy = empire.galaxy;
    const ctx: PolicyPanelContext = { facilities: planetaryFacilityDefinitionsStatic(galaxy) };
    const sections: PolicySection[] = buildPolicyPanel(empire, empire.policy ?? defaultEmpirePolicy(), ctx);
    const controls = panelControls(sections);
    const playerIsPirate = (galaxy.playerEmpire ?? empire).pirateEmpireBaseHabitat !== null;

    // Worker mode: the automation values this panel has issued (the replica shows them one round trip later).
    const sentControls = new Map<string, unknown>();
    // Main.Part2.cs WqesexberY_Click: _Game.PlayerEmpire.Policy = method_597(panel, PlayerEmpire) — run on every change.
    const apply = (): void => {
        // The automation combos (which the C# method_597 writes into the empire) become setEmpireControl commands (only
        // the values that change), then the policy: a screen never writes the game (in-thread the write would bypass
        // the command log and a replay would drift; in worker mode the replica is read-only — docs/sim-worker.md §8).
        const changes: PolicyAutomationChange[] = [];
        const policy = applyPolicyPanel(empire, playerIsPirate, controls, ctx, (field, value) => {
            const c = policyAutomationChange(empire, field, value, sentControls);
            if (c !== null) changes.push(c);
        });
        // Command log: queued, applied at the next frame boundary.
        for (const c of changes) {
            sentControls.set(c.field, c.value);
            issuePlayerCommand(galaxy, empire, 'setEmpireControl', [c.field, c.value]);
        }
        issuePlayerCommand(galaxy, empire, 'setPolicy', [policy]);
    };

    const root = el('div', 'policy-wrap');
    const win = el('div', 'policy-window');
    const titlebar = el('div', 'policy-titlebar');
    titlebar.appendChild(el('div', 'policy-heading', policyText('Empire Policy')));
    // btnEmpirePolicyLoad / btnEmpirePolicySave (110 × 30 at the bottom in the original).
    const files = el('div', 'policy-files');
    const loadBtn = el('button', 'policy-file-button policy-load', policyText('Load'));
    loadBtn.type = 'button';
    loadBtn.title = policyText('Load Distant Worlds empire policy');
    const saveBtn = el('button', 'policy-file-button policy-save', policyText('Save'));
    saveBtn.type = 'button';
    saveBtn.title = policyText('Save Distant Worlds empire policy');
    files.append(loadBtn, saveBtn);
    titlebar.appendChild(files);
    const closeBtn = el('button', 'policy-close', '✕');
    closeBtn.type = 'button';
    closeBtn.title = 'Close';
    titlebar.appendChild(closeBtn);
    win.appendChild(titlebar);

    const nav = el('div', 'policy-nav');
    const body = el('div', 'policy-body');
    sections.forEach((s, i) => {
        const band = el('div', 'policy-band');
        band.id = `policy-section-${i}`;
        band.appendChild(el('div', 'policy-band-title', s.title));
        const autos = el('div', 'policy-band-auto');
        for (const a of s.automation) autos.appendChild(comboElement(a.control, apply));
        band.appendChild(autos);
        body.appendChild(band);
        for (const r of s.rows) {
            if (r.note !== undefined) body.appendChild(el('div', 'policy-explanation', r.note));
            body.appendChild(rowElement(r, apply));
        }

        const link = el('button', 'policy-nav-link', s.title);
        link.type = 'button';
        link.addEventListener('click', () => band.scrollIntoView({ block: 'start' }));
        nav.appendChild(link);
    });
    const main = el('div', 'policy-main');
    main.append(nav, body);
    win.appendChild(main);
    root.appendChild(win);
    document.body.appendChild(root);

    function close(): void {
        document.removeEventListener('keydown', onKeyDown);
        root.remove();
        open = null;
    }
    // Escape closes (method_596); stopImmediatePropagation keeps the global game-menu handler from also opening.
    function onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            close();
        }
    }
    document.addEventListener('keydown', onKeyDown);
    closeBtn.addEventListener('click', () => close());

    // ---- Load / Save (the OpenFileDialog / SaveFileDialog on the Policy folder) ----
    let picker: HTMLElement | null = null;
    const closePicker = (): void => {
        picker?.remove();
        picker = null;
    };
    const openPicker = (title: string): HTMLElement => {
        closePicker();
        const p = el('div', 'policy-file-picker');
        p.appendChild(el('div', 'policy-file-title', title));
        const x = el('button', 'policy-close policy-file-cancel', '✕');
        x.type = 'button';
        x.addEventListener('click', closePicker);
        p.appendChild(x);
        win.appendChild(p);
        picker = p;
        return p;
    };
    loadBtn.addEventListener('click', () => {
        const p = openPicker(policyText('Load Distant Worlds empire policy'));
        const list = el('div', 'policy-file-list');
        const entries = policyFileEntries(MANIFEST);
        if (entries.length === 0) list.appendChild(el('div', 'policy-file-none', `(${policyText('None')})`));
        for (const entry of entries) {
            const b = el('button', `policy-file-entry policy-file-${entry.source}`, entry.name);
            b.type = 'button';
            b.title = entry.source === 'saved' ? 'Saved in this browser' : `Policy/${entry.name}`;
            b.addEventListener('click', () => {
                void readPolicyFileEntry(entry).then(
                    (text) => {
                        // EmpirePolicy.LoadFromFile on the player's policy, then method_595 re-binds the panel.
                        const policy = loadEmpirePolicyFile(empire.policy ?? defaultEmpirePolicy(), text);
                        issuePlayerCommand(galaxy, empire, 'setPolicy', [policy], () => {
                            if (open === null || open.root !== root) return;
                            close();
                            open = createEmpirePolicy(opts);
                        });
                        closePicker();
                    },
                    () => showToast(`Cannot read ${entry.name}`),
                );
            });
            list.appendChild(b);
        }
        p.appendChild(list);
    });
    saveBtn.addEventListener('click', () => {
        const p = openPicker(policyText('Save Distant Worlds empire policy'));
        const form = el('div', 'policy-file-form');
        const input = el('input', 'policy-file-name');
        input.type = 'text';
        input.value = 'MyPolicy.txt';
        input.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') e.stopPropagation();
            if (e.key === 'Enter') save();
        });
        const ok = el('button', 'policy-file-button policy-file-ok', policyText('Save'));
        ok.type = 'button';
        form.append(input, ok);
        p.appendChild(form);
        const existing = savedPolicyFiles();
        if (existing.length > 0) p.appendChild(el('div', 'policy-file-existing', existing.join(', ')));
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
        ok.addEventListener('click', save);
    });
    return { root, close };
}

function comboElement(c: ComboControl, onChange: () => void): HTMLSelectElement {
    const sel = el('select', 'policy-select');
    c.options.forEach((o, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = o;
        sel.appendChild(opt);
    });
    sel.selectedIndex = c.index;
    sel.addEventListener('change', () => {
        c.index = sel.selectedIndex;
        onChange();
    });
    return sel;
}

function controlElement(c: PolicyControl, readOnly: boolean, onChange: () => void): HTMLElement {
    switch (c.kind) {
        case 'combo':
            return comboElement(c, onChange);
        case 'check': {
            const box = el('input', 'policy-check');
            box.type = 'checkbox';
            box.checked = c.checked;
            box.addEventListener('change', () => {
                c.checked = box.checked;
                onChange();
            });
            return box;
        }
        case 'numeric': {
            const input = el('input', 'policy-number');
            input.type = 'number';
            input.min = String(c.min);
            input.max = String(c.max);
            input.step = '1';
            input.value = String(c.value);
            input.addEventListener('change', () => {
                const v = Number(input.value);
                // NumericUpDown keeps the value inside Minimum..Maximum (method_625).
                c.value = clampNumeric(Number.isFinite(v) ? v : c.value, c.min, c.max);
                input.value = String(c.value);
                onChange();
            });
            return input;
        }
        case 'design': {
            // DesignDropDown (method_615): "(None)" then the designs; dFwNhteflw reads SelectedDesign back.
            const sel = el('select', 'policy-select policy-design');
            const items: (unknown | null)[] = [null, ...c.designs];
            items.forEach((d, i) => {
                const opt = document.createElement('option');
                opt.value = String(i);
                opt.textContent = designLabel(d);
                sel.appendChild(opt);
            });
            sel.selectedIndex = Math.max(0, items.indexOf(c.design));
            sel.disabled = readOnly;
            sel.addEventListener('change', () => {
                c.design = items[sel.selectedIndex] ?? null;
                c.label = designLabel(c.design);
                onChange();
            });
            return sel;
        }
    }
}

function rowElement(r: PolicyRow, onChange: () => void): HTMLElement {
    const line = el('div', 'policy-row');
    const label = el('label', 'policy-label', r.label);
    const ctl = controlElement(r.control, r.readOnly === true, onChange);
    if (r.readOnly) {
        line.classList.add('policy-row-readonly');
        line.title = 'Not yet available';
    }
    line.append(label, ctl);
    if (r.suffix !== '') {
        // method_626: a combo's suffix longer than 30 characters becomes its tooltip instead of a label.
        if (r.suffix.length > 30 && r.control.kind === 'combo') ctl.title = r.suffix;
        else line.appendChild(el('span', 'policy-suffix', r.suffix));
    }
    return line;
}
