// Research screen (task 15b): a streamlined Research panel opened by F7 or the
// top-bar "Research" button. One tab per industry (Main.Part6.cs method_398:
// label, current project and progress, glow colour), the industry's research
// queue with progress bars, crash-program / remove buttons, and the industry's
// tech tree grouped by tech level with each node coloured by its state
// (ResearchTree.cs DrawNode). Clicks port ResearchTree.cs OnMouseClick outside
// edit mode (left click queues / starts a crash program, right click removes).
// Leaves out the original's scrolling node-graph canvas, node art, hover info
// panel and edit mode.
// Note: the player's `controlResearch` is true, so performResearchProjects
// (researchTick.ts) auto-picks a project whenever a queue runs empty.

import './researchScreen.css';
import { ResearchSystem, nodeIndustry, type TechNode } from '../../sim/researchSystem';
import { IndustryType } from '../../sim/types';
import {
    calculateResearchTotal,
    calculateCrashResearchProgramCost,
    initiateCrashResearchProgram,
} from '../../sim/researchTick';
import type { Empire } from '../../sim/empire';
import type { Race } from '../../sim/data/races';
import { formatMoney } from '../hud';
import { showToast } from '../toast';

export const RESEARCH_INDUSTRIES = [IndustryType.Weapon, IndustryType.Energy, IndustryType.HighTech] as const;

/** Main.Part6.cs method_398 button labels. */
export function researchIndustryLabel(industry: IndustryType): string {
    switch (industry) {
        case IndustryType.Weapon: return 'Weapons';
        case IndustryType.Energy: return 'Energy & Construction';
        case IndustryType.HighTech: return 'HighTech & Industrial';
        default: return '';
    }
}

/** Main.Part6.cs method_398 glowColor per industry. */
export const INDUSTRY_COLORS: Record<number, number> = {
    [IndustryType.Weapon]: 0xff4060,
    [IndustryType.Energy]: 0x6040ff,
    [IndustryType.HighTech]: 0x40ff60,
};

/** C# ToString("0%"). */
export function formatPercent0(v: number): string {
    if (!Number.isFinite(v)) return '0%';
    return `${Math.round(v * 100)}%`;
}

/** Port of Main.Part6.cs method_398 MinorText. */
export function currentProjectText(rs: ResearchSystem, industry: IndustryType): string {
    const q = rs.researchQueueFor(industry);
    const node = q && q.length > 0 ? q[0] : null;
    if (node === null) return '(No project)';
    return `(${node.def.name}  ${formatPercent0(node.progress / node.cost)})`;
}

/** Port of ResearchSystem.cs:1635 CheckNodeValidForRace (allowed-races half). */
export function checkNodeValidForRace(rs: ResearchSystem, node: TechNode, race: Race | null): boolean {
    // TODO(port): DisallowedRaces — ResearchSystem.cs:1640 (not exposed by researchSystem.ts)
    if (rs.allowedRacesCount(node) > 0) return race !== null && rs.allowedRacesContains(node, race);
    return true;
}

export type ResearchNodeStatus = 'completed' | 'researching' | 'queued' | 'restricted' | 'available' | 'disabled' | 'locked';

/** Node state as drawn by ResearchTree.cs:1287-1301 DrawNode. */
export function researchNodeStatus(rs: ResearchSystem, node: TechNode, race: Race | null): ResearchNodeStatus {
    const idx = rs.researchQueueFor(nodeIndustry(node))?.indexOf(node) ?? -1;
    if (node.isResearched) return 'completed';
    if (idx === 0) return 'researching';
    if (idx > 0) return 'queued';
    if (!checkNodeValidForRace(rs, node, race)) return 'restricted';
    if (rs.canResearchNode(node)) return 'available';
    if (!node.isEnabled) return 'disabled';
    return 'locked';
}

export interface ResearchQueueRow {
    node: TechNode;
    /** `name (index+1)`, as in DrawNode. */
    label: string;
    /** progress / cost clamped to [0, 1]; 0 when cost <= 0. */
    percent: number;
    isRushing: boolean;
    index: number;
}

export function researchQueueRows(rs: ResearchSystem, industry: IndustryType): ResearchQueueRow[] {
    const q = rs.researchQueueFor(industry) ?? [];
    return q.map((node, index) => {
        const percent = node.cost <= 0 ? 0 : Math.min(1, Math.max(0, node.progress / node.cost));
        return {
            node,
            label: `${node.def.name} (${index + 1})`,
            percent: Number.isFinite(percent) ? percent : 0,
            isRushing: node.isRushing,
            index,
        };
    });
}

export interface ResearchCounts {
    completed: number;
    total: number;
    byIndustry: Map<IndustryType, { completed: number; total: number }>;
}

export function researchCounts(rs: ResearchSystem): ResearchCounts {
    const byIndustry = new Map<IndustryType, { completed: number; total: number }>();
    let completed = 0;
    let total = 0;
    for (const n of rs.techTree) {
        total++;
        if (n.isResearched) completed++;
        const ind = nodeIndustry(n);
        if (ind === IndustryType.Undefined) continue;
        let e = byIndustry.get(ind);
        if (!e) {
            e = { completed: 0, total: 0 };
            byIndustry.set(ind, e);
        }
        e.total++;
        if (n.isResearched) e.completed++;
    }
    return { completed, total, byIndustry };
}

export interface ResearchTreeColumn {
    techLevel: number;
    nodes: { node: TechNode; status: ResearchNodeStatus }[];
}

export function researchTreeColumns(rs: ResearchSystem, industry: IndustryType, race: Race | null): ResearchTreeColumn[] {
    const byLevel = new Map<number, TechNode[]>();
    for (const n of rs.techTree) {
        if (nodeIndustry(n) !== industry) continue;
        const list = byLevel.get(n.def.techLevel);
        if (list) list.push(n);
        else byLevel.set(n.def.techLevel, [n]);
    }
    return [...byLevel.keys()]
        .sort((a, b) => a - b)
        .map((techLevel) => ({
            techLevel,
            nodes: byLevel
                .get(techLevel)!
                .sort((a, b) => a.def.row - b.def.row || a.def.projectId - b.def.projectId)
                .map((node) => ({ node, status: researchNodeStatus(rs, node, race) })),
        }));
}

// Port of ResearchTree.cs:1185-1189 OnMouseClick (left click, not queued)
export function queueResearchProject(rs: ResearchSystem, node: TechNode, race: Race | null): boolean {
    if (node.isResearched) return false;
    const items = rs.researchQueueFor(nodeIndustry(node));
    if (items === null) return false;
    if (items.includes(node)) return false;
    if (!checkNodeValidForRace(rs, node, race) || !rs.canResearchNode(node)) return false;
    items.push(node);
    return true;
}

// Port of ResearchTree.cs:1209-1225 OnMouseClick (right click, queued): remove the node, then drop
// every later entry that can no longer be researched (evaluated as it goes, as in the C#).
export function dequeueResearchProject(rs: ResearchSystem, node: TechNode): boolean {
    const items = rs.researchQueueFor(nodeIndustry(node));
    if (items === null || !items.includes(node)) return false;
    if (node.isRushing) return false; // "Cannot cancel crash programs"
    const index1 = items.indexOf(node);
    items.splice(index1, 1);
    const researchNodeList = [...items];
    if (index1 < researchNodeList.length) {
        for (let index2 = index1; index2 < researchNodeList.length; ++index2) {
            if (!rs.canResearchNode(researchNodeList[index2])) {
                const i = items.indexOf(researchNodeList[index2]);
                if (i >= 0) items.splice(i, 1);
            }
        }
    }
    return true;
}

export interface CrashOffer {
    node: TechNode;
    cost: number;
    affordable: boolean;
}

/** ResearchTree.cs:1191-1207 OnMouseClick (left click on queue[0], not rushing). */
export function crashResearchOffer(empire: Empire, node: TechNode): CrashOffer | null {
    const q = empire.research.researchQueueFor(nodeIndustry(node));
    if (!q || q[0] !== node || node.isRushing) return null;
    const cost = calculateCrashResearchProgramCost(empire, node);
    return { node, cost, affordable: empire.stateMoney >= cost };
}

/** GameText.txt 3128 "Crash Research Initiate Question". */
export function crashQuestion(name: string, cost: number): string {
    const c = formatMoney(cost);
    return `Would you like to initiate a crash program to research ${name}?\n\n` +
        `This would triple our research speed for this project, but would cost us ${c} credits.\n\n` +
        `Should we spend ${c} credits on this crash research program?`;
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

export interface ResearchScreenOptions {
    /** The player's empire. */
    empire: Empire;
}

interface OpenState {
    root: HTMLElement;
    close: () => void;
}

let open: OpenState | null = null;
let selectedIndustry: IndustryType = IndustryType.Weapon;

/** Open the Research screen, or close it if it is already open. */
export function toggleResearchScreen(opts: ResearchScreenOptions): void {
    if (open) {
        open.close();
    } else {
        open = createResearchScreen(opts);
    }
}

/** Close the Research screen (no-op when closed). */
export function closeResearchScreen(): void {
    open?.close();
}

function hex(c: number): string {
    return `#${c.toString(16).padStart(6, '0')}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

function progressBar(percent: number, cls = 'research-bar'): HTMLElement {
    const bar = el('div', cls);
    const fill = el('div', 'research-bar-fill');
    fill.style.width = `${Math.round(percent * 100)}%`;
    bar.appendChild(fill);
    return bar;
}

function industryOutput(empire: Empire, industry: IndustryType): number {
    const t = calculateResearchTotal(empire);
    switch (industry) {
        case IndustryType.Weapon: return t.researchWeapons;
        case IndustryType.Energy: return t.researchEnergy;
        case IndustryType.HighTech: return t.researchHighTech;
        default: return 0;
    }
}

function createResearchScreen(opts: ResearchScreenOptions): OpenState {
    const { empire } = opts;
    const rs = empire.research;

    const root = el('div', 'research-wrap');
    const win = el('div', 'research-window');

    const titlebar = el('div', 'research-titlebar');
    titlebar.appendChild(el('div', 'research-heading', 'Research'));
    const closeBtn = el('button', 'research-close', '✕');
    closeBtn.type = 'button';
    closeBtn.title = 'Close';
    titlebar.appendChild(closeBtn);
    win.appendChild(titlebar);

    const body = el('div', 'research-body');
    win.appendChild(body);
    root.appendChild(win);
    document.body.appendChild(root);

    let treeScroll = 0;
    // In-place updaters for the 1 s tick (progress text/bars); the DOM is only rebuilt when the
    // structure (queues, node states, crash affordability) changes, so clicks are not lost mid-rebuild.
    let updaters: (() => void)[] = [];
    let renderedKey = '';

    function structureKey(): string {
        const parts: string[] = [String(selectedIndustry)];
        for (const ind of RESEARCH_INDUSTRIES) {
            for (const n of rs.researchQueueFor(ind) ?? []) parts.push(`${n.def.projectId}${n.isRushing ? 'r' : ''}`);
            parts.push('|');
        }
        const q = rs.researchQueueFor(selectedIndustry);
        if (q && q.length > 0) parts.push(String(crashResearchOffer(empire, q[0])?.affordable ?? '-'));
        for (const col of researchTreeColumns(rs, selectedIndustry, empire.dominantRace)) {
            for (const { node, status } of col.nodes) parts.push(`${node.def.projectId}:${status[0]}${node.progress > 0 ? 'p' : ''}`);
        }
        return parts.join(',');
    }

    function tick(): void {
        if (structureKey() !== renderedKey) render();
        else for (const u of updaters) u();
    }

    function render(): void {
        const prevTree = body.querySelector('.research-tree');
        if (prevTree) treeScroll = prevTree.scrollLeft;
        body.replaceChildren();
        updaters = [];
        renderedKey = structureKey();

        const counts = researchCounts(rs);
        body.appendChild(el('div', 'research-summary', `Completed: ${counts.completed} / ${counts.total}`));

        // Industry tabs (Main.Part6.cs method_398).
        const tabs = el('div', 'research-tabs');
        for (const ind of RESEARCH_INDUSTRIES) {
            const tab = el('button', 'research-tab');
            tab.type = 'button';
            if (ind === selectedIndustry) tab.classList.add('research-tab-selected');
            tab.style.borderBottom = `3px solid ${hex(INDUSTRY_COLORS[ind])}`;
            tab.appendChild(el('div', 'research-tab-label', researchIndustryLabel(ind)));
            const c = counts.byIndustry.get(ind);
            const minor = el('div', 'research-tab-minor', currentProjectText(rs, ind));
            updaters.push(() => { minor.textContent = currentProjectText(rs, ind); });
            tab.appendChild(minor);
            if (c) tab.appendChild(el('div', 'research-tab-minor', `${c.completed} / ${c.total} completed`));
            tab.addEventListener('click', () => {
                selectedIndustry = ind;
                treeScroll = 0;
                render();
            });
            tabs.appendChild(tab);
        }
        body.appendChild(tabs);

        const output = el('div', 'research-output');
        const outputText = (): string => `Output: ${formatMoney(industryOutput(empire, selectedIndustry))} / yr`;
        output.textContent = outputText();
        updaters.push(() => { output.textContent = outputText(); });
        body.appendChild(output);

        // Queue.
        body.appendChild(el('div', 'research-section', 'Queue'));
        const rows = researchQueueRows(rs, selectedIndustry);
        const queue = el('div', 'research-queue');
        if (rows.length === 0) queue.appendChild(el('div', 'research-empty', '(No project)'));
        for (const row of rows) {
            const line = el('div', 'research-row');
            if (row.index === 0) line.classList.add('research-row-current');
            line.appendChild(el('span', 'research-row-name', row.label));
            const bar = progressBar(row.percent);
            const pct = el('span', 'research-row-percent', formatPercent0(row.percent));
            const node = row.node;
            updaters.push(() => {
                const p = node.cost <= 0 ? 0 : Math.min(1, Math.max(0, node.progress / node.cost));
                (bar.firstChild as HTMLElement).style.width = `${Math.round(p * 100)}%`;
                pct.textContent = formatPercent0(p);
            });
            line.append(bar, pct);

            const actions = el('span', 'research-row-actions');
            if (row.isRushing) {
                actions.appendChild(el('span', 'research-crash-tag', 'CRASH PROGRAM'));
            } else if (row.index === 0) {
                const offer = crashResearchOffer(empire, row.node);
                if (offer !== null) {
                    const crash = el('button', 'research-crash', 'Crash program');
                    crash.type = 'button';
                    crash.title = `Initiate Crash Research Program? (${formatMoney(offer.cost)} credits)`;
                    crash.addEventListener('click', () => {
                        const o = crashResearchOffer(empire, row.node);
                        if (o === null) return;
                        if (!o.affordable) {
                            showToast('Not enough money for Crash Research Program');
                            return;
                        }
                        if (window.confirm(crashQuestion(row.node.def.name, o.cost))) {
                            initiateCrashResearchProgram(empire.galaxy, empire, row.node, o.cost);
                            render();
                        }
                    });
                    actions.appendChild(crash);
                }
            }
            const remove = el('button', 'research-remove', '✕');
            remove.type = 'button';
            if (row.isRushing) {
                remove.disabled = true;
                remove.title = 'Cannot cancel crash programs';
            } else {
                remove.title = 'Remove from queue';
                remove.addEventListener('click', () => {
                    dequeueResearchProject(rs, row.node);
                    render();
                });
            }
            actions.appendChild(remove);
            line.appendChild(actions);
            queue.appendChild(line);
        }
        body.appendChild(queue);

        // Tree (ResearchTree.cs DrawNode states), grouped by tech level.
        body.appendChild(el('div', 'research-section', 'Tree'));
        const tree = el('div', 'research-tree');
        for (const col of researchTreeColumns(rs, selectedIndustry, empire.dominantRace)) {
            const column = el('div', 'research-column');
            column.appendChild(el('div', 'research-column-heading', `Level ${col.techLevel}`));
            for (const { node, status } of col.nodes) {
                const chip = el('div', `research-node research-node-${status}`, node.def.name);
                if (status === 'available') {
                    chip.title = 'Click to queue research';
                    chip.addEventListener('click', () => {
                        queueResearchProject(rs, node, empire.dominantRace);
                        render();
                    });
                }
                if (node.progress > 0 && !node.isResearched) {
                    const frac = (): number => (node.cost > 0 ? Math.min(1, node.progress / node.cost) : 0);
                    const nb = progressBar(frac(), 'research-node-bar');
                    updaters.push(() => { (nb.firstChild as HTMLElement).style.width = `${Math.round(frac() * 100)}%`; });
                    chip.appendChild(nb);
                }
                column.appendChild(chip);
            }
            tree.appendChild(column);
        }
        body.appendChild(tree);
        tree.scrollLeft = treeScroll;
    }

    render();
    const timer = window.setInterval(tick, 1000);

    function close(): void {
        window.clearInterval(timer);
        document.removeEventListener('keydown', onKeyDown);
        root.remove();
        open = null;
    }

    // Escape closes the panel; stopImmediatePropagation keeps the global game-menu (and other open panels)
    // Escape handler (registered in createHud) from opening as well.
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
