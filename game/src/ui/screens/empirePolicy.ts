// Empire Policy panel (task 17d): the player's automation levels and EmpirePolicy settings, opened by the top-bar
// Empire Policy button (Main.Part2.cs:1184 btnEmpirePolicy_Click toggles method_595 / method_596; the original has
// no hotkey for it). Rows, groups, value ranges and read-back conversions are the original's
// (empirePolicyModel.ts: method_609 fill, method_597 apply). Streamlined: one scrolling column of the original's
// header bands with their automation combos on the band, and every change is applied at once through the
// method_597 mapping (the original applies on OK); the Load / Save policy-file buttons are left out.
// TODO(port): btnEmpirePolicyLoad_Click / btnEmpirePolicySave_Click (Main.Part3.cs) — policy files on disk.

import './empirePolicy.css';
import type { Empire } from '../../sim/empire';
import { planetaryFacilityDefinitionsStatic } from '../../sim/construction/facilities';
import { defaultEmpirePolicy } from '../../sim/data/policies';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { isReplicaGalaxy } from '../../simworker/refresh';
import {
    applyPolicyPanel,
    buildPolicyPanel,
    policyAutomationChange,
    type PolicyAutomationChange,
    clampNumeric,
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

    // Main.Part2.cs WqesexberY_Click: _Game.PlayerEmpire.Policy = method_597(panel, PlayerEmpire) — run on every change.
    const apply = (): void => {
        if (!isReplicaGalaxy(galaxy)) {
            // In-thread, as the C# method_597: the automation combos write the empire, the policy is a command.
            // Command log: queued, applied at the next frame boundary.
            issuePlayerCommand(galaxy, empire, 'setPolicy', [applyPolicyPanel(empire, playerIsPirate, controls, ctx)]);
            return;
        }
        // On a sim-worker replica (read-only, docs/sim-worker.md §9 chunk 6) the automation combos become
        // setEmpireControl commands (only the values that change), then the policy.
        const changes: PolicyAutomationChange[] = [];
        const policy = applyPolicyPanel(empire, playerIsPirate, controls, ctx, (field, value) => {
            const c = policyAutomationChange(empire, field, value);
            if (c !== null) changes.push(c);
        });
        // Command log: queued, applied at the next frame boundary.
        for (const c of changes) issuePlayerCommand(galaxy, empire, 'setEmpireControl', [c.field, c.value]);
        issuePlayerCommand(galaxy, empire, 'setPolicy', [policy]);
    };

    const root = el('div', 'policy-wrap');
    const win = el('div', 'policy-window');
    const titlebar = el('div', 'policy-titlebar');
    titlebar.appendChild(el('div', 'policy-heading', policyText('Empire Policy')));
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
            const sel = el('select', 'policy-select');
            const opt = document.createElement('option');
            opt.textContent = c.label;
            sel.appendChild(opt);
            sel.disabled = readOnly;
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
