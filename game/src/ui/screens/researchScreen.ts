// Research screen: a port of the original's pnlResearch (Main.Part6.cs method_395, opened by F7 or the top-bar
// research button) on the shared original-style window (originalWindow.ts):
//   - the window sized by method_389 (1020 × 767 up to 1880 × 1180 by the main-form size), the instructions label and
//     the "Learn about Research..." link;
//   - the Weapons / Energy & Construction / HighTech & Industrial glass tabs coloured by method_398 (with the current
//     project and its progress as the minor text) and the Research Stations tab;
//   - the industry's tech tree as DistantWorlds.Controls/ResearchTree.cs draws it (researchTreeModel.ts): glass node
//     buttons coloured by component category with their component / facility / fighter / troop pictures, queue
//     numbers and borders (the current project's border pulses), the crash-program icon, progress bars, red / grey
//     arrows from each parent (dashed across categories), drag to scroll, left click to queue or start a crash program,
//     right click to cancel; the hover panel (DrawProjectInfo) with the project size, state and what it unlocks
//     (researchBenefits.ts GenerateBenefitDetail);
//   - the Research Stations page: the stations grid (ResearchFacilities), Go to Research Station, the research summary
//     (ResearchSummary: capacity and actual output per field), total research potential, government and race
//     modifiers, the maximum construction sizes (method_305) and the special bonuses (SummarizeSpecialResearchBonuses).
// Kept from our earlier screen (not in the original), in the same look: the research queue panel at the tree's right
// edge (the industry's queue with progress bars, crash-program and remove buttons, completed counts and output per
// year; it can be collapsed) and the "(stolen)" marker of the espionage scenario.
// Note: the player's `controlResearch` is true, so performResearchProjects (researchTick.ts) auto-picks a project
// whenever a queue runs empty.

import { stolenTechMarker } from '../../sim/scenario/emergent/espionageView';
import './researchScreen.css';
import { ResearchSystem, nodeIndustry, type TechNode } from '../../sim/researchSystem';
import { IndustryType } from '../../sim/types';
import {
    annualResearchPotential,
    calculateCrashResearchProgramCost,
    calculateResearchOutputBonuses,
    calculateResearchTotal,
    researchPotential,
} from '../../sim/researchTick';
import type { Empire } from '../../sim/empire';
import { empireGovernmentAttributes } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { Race } from '../../sim/data/races';
import type { BuiltObject } from '../../sim/builtObject';
import { BuiltObjectSubRole } from '../../sim/builtObjectTypes';
import { TroopType } from '../../sim/cargo';
import { CharacterRole, CharacterTraitType, checkCharactersForTrait, getEmpireCharacters, getNonTransferringCharacters, stellarObjectCharacters } from '../../sim/characters';
import { ColonyResourceEffect } from '../../sim/developmentLevel';
import { formatMoney, selectStellarObject } from '../hud';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { checkNodeValidForRace, queueResearchProject, dequeueResearchProject } from '../../sim/player/playerOrders';
import {
    COLORS,
    FONT,
    OwGrid,
    chromeImageUrl,
    el,
    glassButton,
    gradientPanel,
    linkLabel,
    messageBox,
    originalVirtualSize,
    openOriginalWindow,
    place,
    rgbCss,
    setButtonMinorText,
    setText,
    text,
    type OriginalWindow,
} from '../originalWindow';
import { uiScaleFactor } from '../settings';
import { openGalactopedia } from './galactopedia';
import { empireFlagUrl } from '../selectionInfoView';
import { shipImageUrl } from '../selectionInfo';
import { builtObjectImageUrl } from '../../render/builtObjectLayer';
import { familyPictureRef } from '../../render/wreckDebris';
import { fighterImageUrl } from '../../render/fighterLayer';
import { troopImageUrl } from '../../render/troopImages';
import {
    TREE,
    calculateNodeLocation,
    detectNodeAt,
    determineRanges,
    generateNodeImages,
    industryNodes,
    industryTabStyle,
    nodeColors,
    nodePath,
    nodeRaces,
    nodeValidForRace,
    nodeVisual,
    pathStyle,
    projectInfoColumns,
    projectInfoHeight,
    projectInfoPosition,
    raceImageUrl,
    researchWindowSize,
    treeBackColor,
    treeContentSize,
    type NodeImageResolvers,
    type NodeVisual,
    type TreeRanges,
} from './researchTreeModel';
import {
    benefitCount,
    formatGrouped,
    formatK,
    formatSignedPercent,
    formatSignedPercentHash,
    generateBenefitDetail,
    gt,
    resolveNodeDescription,
} from './researchBenefits';
import { requestSimRefresh } from '../../simworker/refresh';
export { checkNodeValidForRace, queueResearchProject, dequeueResearchProject };

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
    if (node === null) return `(${gt('No project')})`;
    return `(${node.def.name}  ${formatPercent0(node.progress / node.cost)})`;
}

export type ResearchNodeStatus = 'completed' | 'researching' | 'queued' | 'restricted' | 'available' | 'disabled' | 'locked';

/** Node state as drawn by ResearchTree.cs:1287-1301 DrawNode (a summary used by the queue panel and tests). */
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

/** The industry's projects grouped by tech level (sorted by row). */
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

/** GameText.txt "Crash Research Initiate Question" ({1} = cost.ToString("###,###,###,##0")). */
export function crashQuestion(name: string, cost: number): string {
    return gt('Crash Research Initiate Question', name, formatGrouped(cost));
}

/** GameText.txt "Crash Research Cannot Afford". */
export function crashCannotAfford(cost: number, money: number): string {
    return gt('Crash Research Cannot Afford', formatGrouped(cost), formatGrouped(money));
}

// ---------------------------------------------------------------------------------------------------------------
// Research Stations page (pure parts)
// ---------------------------------------------------------------------------------------------------------------

/** Main.Part6.cs method_395 (1440-1452): the player's own and private built objects with any research output. */
export function researchFacilities(empire: Empire): BuiltObject[] {
    const out: BuiltObject[] = [];
    for (const b of [...empire.builtObjects, ...empire.privateBuiltObjects]) {
        if (b.researchEnergy > 0 || b.researchHighTech > 0 || b.researchWeapons > 0) out.push(b);
    }
    return out;
}

/** ResearchFacilities.CalculateCurrentResearch: the output while functional, else 0. */
export function currentResearch(b: BuiltObject, output: number): number {
    return b.isFunctional ? Math.trunc(output) : 0;
}

/** Main.Part8.cs method_305: maximum ship (", C:" civilian / ", M:" military when they differ) and base sizes. */
export function maximumSizeText(empire: Empire): string {
    const num = empire.maximumConstructionSize();
    const num2 = empire.maximumConstructionSize(BuiltObjectSubRole.SmallFreighter);
    const num3 = empire.maximumConstructionSize(BuiltObjectSubRole.Frigate);
    let t = String(num);
    if (num2 !== num) t += ', C:' + num2;
    if (num3 !== num) t += ', M:' + num3;
    return gt('Maximum Ship size') + ': ' + t + '\n' + gt('Maximum Base size') + ': ' + empire.maximumConstructionSizeBase() + ' (' + gt('when not at colony') + ')';
}

/** CharacterList.TotalDiminishingResearchBonuses*: the skills sorted descending, summed as value / (rank + 1), / 100. */
export function totalDiminishingResearchBonus(skills: readonly number[]): number {
    if (skills.length === 0) return 0;
    const s = [...skills].sort((a, b) => b - a);
    let n = 0;
    for (let i = 0; i < s.length; i++) n += s[i] / (i + 1);
    return n / 100.0;
}

/** Port of Empire.3.cs 1115 SummarizeSpecialResearchBonuses (leader, ultra-genius scientist, the best station per
 *  field with its location / scientist breakdown, ruin / wonder bonuses, the historical discovery and colony resources).
 *  TODO(port): the construction-yard repair bonuses and the pirate-base bonus lines — Empire.3.cs:1320-1363. */
export function summarizeSpecialResearchBonuses(empire: Empire): string {
    let t = '';
    let num = 0;
    const leader = empire.leader;
    if (leader !== null) {
        const field = (value: number, inc: string, dec: string): void => {
            if (value > 0) t += gt(inc, leader.name, formatSignedPercent(value / 100.0)) + '\n';
            else if (value < 0) t += gt(dec, leader.name, `-${Math.round(Math.abs(value))}%`) + '\n';
        };
        field(leader.researchEnergy, 'Research Leader Bonus Energy Increase', 'Research Leader Bonus Energy Decrease');
        field(leader.researchHighTech, 'Research Leader Bonus HighTech Increase', 'Research Leader Bonus HighTech Decrease');
        field(leader.researchWeapons, 'Research Leader Bonus Weapons Increase', 'Research Leader Bonus Weapons Decrease');
    }
    const chars = getEmpireCharacters(empire);
    if (checkCharactersForTrait(chars, CharacterRole.Scientist, CharacterTraitType.UltraGenius)) {
        const c = chars.find((x) => x !== null && x.traits.includes(CharacterTraitType.UltraGenius));
        t += gt('Research UltraGenius Scientist Bonus', c?.name ?? '', '+20%') + '\n';
    }
    const station = (bonus: number, b: BuiltObject | null, industry: IndustryType, tag: string, skill: (c: { researchWeapons: number; researchEnergy: number; researchHighTech: number }) => number): void => {
        if (!(bonus > 0) || b === null) return;
        t += gt(tag, formatSignedPercentHash(bonus), b.name) + '\n';
        const list = getNonTransferringCharacters(stellarObjectCharacters(b) ?? [], CharacterRole.Scientist);
        const sci = totalDiminishingResearchBonus(list.map(skill));
        let loc = 0;
        if (b.parentHabitat !== null && b.parentHabitat.researchBonusIndustry === industry && b.parentHabitat.researchBonus > 0) loc = Math.trunc(b.parentHabitat.researchBonus) / 100;
        else if (b.nearestSystemStar !== null && b.nearestSystemStar.researchBonusIndustry === industry && b.nearestSystemStar.researchBonus > 0) loc = Math.trunc(b.nearestSystemStar.researchBonus) / 100;
        t += '    (' + gt('Research Bonus Breakdown', formatSignedPercent(loc), formatSignedPercent(sci)) + ')\n';
    };
    station(empire.researchBonusWeapons, empire.researchBonusWeaponsStation, IndustryType.Weapon, 'Weapons Research Bonus from Station', (c) => c.researchWeapons);
    station(empire.researchBonusEnergy, empire.researchBonusEnergyStation, IndustryType.Energy, 'Energy Research Bonus from Station', (c) => c.researchEnergy);
    station(empire.researchBonusHighTech, empire.researchBonusHighTechStation, IndustryType.HighTech, 'HighTech Research Bonus from Station', (c) => c.researchHighTech);
    const special = (value: number, ruin: { name: string } | null, wonder: unknown, tag: string): void => {
        if (!(value > 0)) return;
        const w = wonder as { name?: string } | null;
        const name = ruin !== null ? ruin.name : w != null ? (w.name ?? '') : null;
        if (name === null) return;
        t += gt(tag, formatSignedPercentHash(value), name) + ', ';
        num++;
    };
    special(empire.specialBonusResearchEnergy, empire.specialBonusResearchEnergyRuin, empire.specialBonusResearchEnergyWonder, 'Energy Research Bonus from Ruin');
    special(empire.specialBonusResearchWeapons, empire.specialBonusResearchWeaponsRuin, empire.specialBonusResearchWeaponsWonder, 'Weapons Research Bonus from Ruin');
    special(empire.specialBonusResearchHighTech, empire.specialBonusResearchHighTechRuin, empire.specialBonusResearchHighTechWonder, 'HighTech Research Bonus from Ruin');
    // RaceEventType.HistoricalDiscoveryExploreRuinsForResearchBoost (29).
    if (empire.raceEventType === 29) {
        t += gt('Research Bonus From Historical Discovery in Ruins', '10%') + '\n';
        num++;
    }
    let w = 0;
    let e = 0;
    let h = 0;
    let rw = -1;
    let re = -1;
    let rh = -1;
    for (const colony of empire.colonies) {
        for (const rb of colony.resourceBonuses ?? []) {
            if (rb.effect === ColonyResourceEffect.ResearchWeapons) {
                w += rb.value / 100.0;
                rw = rb.resourceId;
            } else if (rb.effect === ColonyResourceEffect.ResearchEnergy) {
                e += rb.value / 100.0;
                re = rb.resourceId;
            } else if (rb.effect === ColonyResourceEffect.ResearchHighTech) {
                h += rb.value / 100.0;
                rh = rb.resourceId;
            }
        }
        w = Math.min(1, w);
        e = Math.min(1, e);
        h = Math.min(1, h);
    }
    const resName = (id: number): string => empire.galaxy?.resources.find((r) => r.resourceId === id)?.name ?? '';
    if (w > 0) {
        t += gt('Weapons Research Bonus From Colony Resources', formatSignedPercentHash(w), resName(rw)) + ' \n';
        num++;
    }
    if (e > 0) {
        t += gt('Energy Research Bonus From Colony Resources', formatSignedPercentHash(e), resName(re)) + ' \n';
        num++;
    }
    if (h > 0) {
        t += gt('HighTech Research Bonus From Colony Resources', formatSignedPercentHash(h), resName(rh)) + ' \n';
        num++;
    }
    if (t.length > 0 && num > 0) t = t.substring(0, t.length - 2);
    return t;
}

/** Empire.ResearchXxxOutput: CalculateResearchTotal's share for the field × CalculateResearchOutputBonuses. */
export function researchOutput(empire: Empire, industry: IndustryType): number {
    const t = calculateResearchTotal(empire);
    const total = industry === IndustryType.Weapon ? t.researchWeapons : industry === IndustryType.Energy ? t.researchEnergy : t.researchHighTech;
    return total * calculateResearchOutputBonuses(empire, industry);
}

// ---------------------------------------------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------------------------------------------

export interface ResearchScreenOptions {
    /** The player's empire. */
    empire: Empire;
}

interface OpenState {
    win: OriginalWindow;
    close: () => void;
}

let open: OpenState | null = null;
/** The page shown (IndustryType.Undefined = Research Stations), kept between openings like pnlResearchTree.Industry. */
let selectedIndustry: IndustryType = IndustryType.Weapon;
/** Our queue panel's state once toggled (null = open when the tree view is wide enough, ≥ 1200 px). */
let queuePanelChoice: boolean | null = null;
let queuePanelOpen = true;

/** Open the Research screen, or close it if it is already open. */
export function toggleResearchScreen(opts: ResearchScreenOptions): void {
    if (open) open.close();
    else open = createResearchScreen(opts);
}

/** Close the Research screen (no-op when closed). */
export function closeResearchScreen(): void {
    open?.close();
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

const rgbTriple = (c: number): string => `${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}`;

/** One drawn node and what was last applied to it. */
interface NodeView {
    node: TechNode;
    el: HTMLDivElement;
    title: HTMLDivElement;
    bar: HTMLDivElement | null;
    barFill: HTMLDivElement | null;
    crash: HTMLImageElement;
    key: string;
}

function createResearchScreen(opts: ResearchScreenOptions): OpenState {
    const { empire } = opts;
    const galaxy = empire.galaxy as Galaxy;
    const rs = empire.research;
    const race = empire.dominantRace;
    const virtual = (): { w: number; h: number } => originalVirtualSize(window.innerWidth, window.innerHeight, uiScaleFactor());
    let size = researchWindowSize(virtual());

    let timer = 0;
    const win = openOriginalWindow({
        id: 'research',
        title: gt('Research'),
        icon: 'research.png',
        width: size.w,
        height: size.h,
        onClose: () => {
            window.clearInterval(timer);
            for (const f of cleanup.splice(0)) f();
            open = null;
        },
        onResize: (w) => {
            const s = researchWindowSize(w.virtualSize);
            if (s.w !== size.w || s.h !== size.h) {
                size = s;
                w.setSize(s.w, s.h);
                build();
            }
        },
    });
    const body = win.body;

    // Picture resolvers for GenerateNodeImages (the player race's fighters, carrier / resupply ship and troops).
    const family = race?.designsPictureFamilyIndex ?? 0;
    const resolvers: NodeImageResolvers = {
        fighterUrl: (bomber) => fighterImageUrl(family * 2 + (bomber ? 1 : 0)),
        shipUrl: (subRole) => builtObjectImageUrl(familyPictureRef(family, subRole)),
        troopUrl: (type) => (race !== null ? troopImageUrl({ type, pictureRef: race.pictureIndex }, galaxy.races.length) : null),
    };

    // Per-build state.
    let tabs: { industry: IndustryType; btn: HTMLButtonElement }[] = [];
    let nodeViews: NodeView[] = [];
    let ranges: TreeRanges | null = null;
    let nodes: TechNode[] = [];
    let view: HTMLDivElement | null = null;
    let content: HTMLDivElement | null = null;
    let svg: SVGSVGElement | null = null;
    let pathsKey = '';
    let info: HTMLDivElement | null = null;
    let infoKey = '';
    let hovered: TechNode | null = null;
    let queuePanel: HTMLDivElement | null = null;
    let queueKey = '';
    let queueUpdaters: (() => void)[] = [];
    let stationsRefresh: (() => void) | null = null;
    let tick = 0;

    function build(): void {
        const keepScroll = view ? { l: view.scrollLeft, t: view.scrollTop, ind: selectedIndustry } : null;
        for (const f of cleanup.splice(0)) f();
        body.replaceChildren();
        tabs = [];
        nodeViews = [];
        view = content = info = queuePanel = null;
        svg = null;
        pathsKey = infoKey = queueKey = '';
        hovered = null;
        stationsRefresh = null;
        queueUpdaters = [];
        const W = size.w;
        const H = size.h;

        // lblResearchInstructions (10, 10), font_7, MaximumSize 800 × 60.
        const instructions =
            '- ' + gt('Click a project to add it to the research queue (previous projects must already be researched)') + '\n' +
            '- ' + gt('Right-click a queued project to cancel research, moving up subsequent projects in the queue') + '\n' +
            '- ' + gt('Click the current project to initiate crash-research, spending credits to shorten the research time');
        const ins = text(instructions, { size: FONT.large, bold: true, color: COLORS.label, shadow: false, wrapWidth: 800 });
        ins.classList.add('rs-instructions');
        body.appendChild(place(ins, 10, 10));
        // lnkResearch (845, 10).
        body.appendChild(place(linkLabel('Learn about Research...', () => openGalactopedia({ topic: 'Research' })), 845, 10));

        // The tabs: btnResearchTreeWeapons / Energy / HighTech (40 / 270 / 500, 75; 230 × 40, 43 when selected) and
        // btnResearchFacilities (730, 75).
        const tabSpecs: { industry: IndustryType; x: number }[] = [
            { industry: IndustryType.Weapon, x: 40 },
            { industry: IndustryType.Energy, x: 270 },
            { industry: IndustryType.HighTech, x: 500 },
            { industry: IndustryType.Undefined, x: 730 },
        ];
        for (const t of tabSpecs) {
            const isInd = t.industry !== IndustryType.Undefined;
            const st = isInd ? industryTabStyle(t.industry) : null;
            const btn = glassButton(isInd ? gt(st!.label) : gt('Research Stations'), {
                corners: { tl: true, tr: true },
                minorText: isInd ? currentProjectText(rs, t.industry) : undefined,
                // method_398 colours; the stations button has IntensifyColors (glow (128, 128, 255)).
                colors: st ? { outer: st.outer, shine: st.shine, glow: st.glow } : { glow: 0x8080ff },
                className: 'rs-tab',
                onClick: () => {
                    if (selectedIndustry === t.industry) return;
                    selectedIndustry = t.industry;
                    build();
                },
            });
            if (t.industry === selectedIndustry) btn.classList.add('rs-tab-on');
            body.appendChild(place(btn, t.x, 75, 230, t.industry === selectedIndustry ? 43 : 40));
            tabs.push({ industry: t.industry, btn });
        }

        if (selectedIndustry === IndustryType.Undefined) {
            buildStations(W, H);
        } else {
            buildTree(W, H, keepScroll && keepScroll.ind === selectedIndustry ? keepScroll : null);
        }
        refresh();
    }

    // -----------------------------------------------------------------------------------------------------------
    // Tree page (WdosRcovZt + ResearchTree)
    // -----------------------------------------------------------------------------------------------------------

    function buildTree(W: number, H: number, keepScroll: { l: number; t: number } | null): void {
        const industry = selectedIndustry;
        const cw = W - 44;
        const ch = H - 192;
        const frame = el('div', 'rs-tree-frame');
        place(frame, 13, 115, cw, ch);
        body.appendChild(frame);
        const v = el('div', 'rs-tree-view ow-scroll');
        frame.appendChild(v);
        view = v;
        nodes = industryNodes(rs, industry);
        const r = determineRanges(nodes);
        ranges = r;
        const sz = treeContentSize(r);
        const c = el('div', 'rs-tree');
        c.style.width = `${sz.w}px`;
        c.style.height = `${sz.h}px`;
        c.style.background = rgbCss(treeBackColor(industry));
        v.appendChild(c);
        content = c;

        // DrawNodePaths: one SVG layer under the nodes.
        const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        s.setAttribute('class', 'rs-paths');
        s.setAttribute('width', String(sz.w));
        s.setAttribute('height', String(sz.h));
        c.appendChild(s);
        svg = s;

        for (const n of nodes) nodeViews.push(buildNode(n, r, c));

        const panel = el('div', 'rs-info');
        panel.hidden = true;
        c.appendChild(panel);
        info = panel;

        wireTreeMouse(v, c, r);
        buildQueuePanel(frame);

        // BindData → CalculatePosition: centre the current project (scroll clamped to the content).
        if (keepScroll) {
            v.scrollLeft = keepScroll.l;
            v.scrollTop = keepScroll.t;
        } else {
            const cur = rs.researchQueueFor(industry)?.[0] ?? null;
            if (cur !== null) {
                const loc = calculateNodeLocation(cur, r);
                v.scrollLeft = Math.max(0, loc.x + TREE.nodeWidth / 2 - cw / 2);
                v.scrollTop = Math.max(0, loc.y + TREE.nodeHeight / 2 - ch / 2);
            }
        }
    }

    function buildNode(n: TechNode, r: TreeRanges, parent: HTMLElement): NodeView {
        const loc = calculateNodeLocation(n, r);
        const colors = nodeColors(rs, n);
        const e = el('div', 'rs-node');
        place(e, loc.x, loc.y, TREE.nodeWidth, TREE.nodeHeight);
        e.style.setProperty('--outer', rgbCss(colors.outer));
        e.style.setProperty('--shine', rgbTriple(colors.shine));
        e.style.setProperty('--glow', rgbTriple(colors.glow));
        e.appendChild(el('div', 'rs-node-border'));
        e.appendChild(el('div', 'rs-node-glass'));
        const images = generateNodeImages(galaxy, rs, n, resolvers);
        if (images.length > 0) {
            let x = 5;
            for (const im of images) {
                const box = el('div', `rs-node-img${im.rotate ? ' rs-rot' : ''}`);
                place(box, x, 18, TREE.imageSize, TREE.imageSize);
                const img = el('img');
                img.src = im.url;
                img.alt = '';
                img.draggable = false;
                box.appendChild(img);
                if (im.improved) {
                    const up = el('img', 'rs-node-up');
                    up.src = chromeImageUrl('UpArrow.png');
                    up.alt = '';
                    up.draggable = false;
                    box.appendChild(up);
                }
                e.appendChild(box);
                x += TREE.imageSize + 5;
            }
        } else {
            // No pictures: Galaxy.ResolveDescription(node) at (43, 17) in the 13 px font.
            const d = el('div', 'rs-node-desc', resolveNodeDescription(galaxy, rs, n));
            place(d, 43, 17, TREE.nodeWidth - 48, TREE.nodeHeight - 18);
            e.appendChild(d);
        }
        // AllowedRaces (right to left) and DisallowedRaces (crossed out in red).
        const { allowed, disallowed } = nodeRaces(galaxy, n);
        let used = 0;
        allowed.forEach((rc, i) => {
            const im = el('img', 'rs-node-race');
            im.src = raceImageUrl(rc.pictureIndex);
            im.alt = '';
            im.title = rc.name;
            place(im, TREE.nodeWidth - (5 + (TREE.imageSize + 5) * (i + 1)), 18, TREE.imageSize, TREE.imageSize);
            e.appendChild(im);
        });
        used = (TREE.imageSize + 5) * allowed.length;
        for (const rc of disallowed) {
            const step = 5 + TREE.imageSize + 5;
            const at = used + step;
            const box = el('div', 'rs-node-race rs-node-race-not');
            box.title = rc.name;
            place(box, TREE.nodeWidth - at, 18, TREE.imageSize, TREE.imageSize);
            const im = el('img');
            im.src = raceImageUrl(rc.pictureIndex);
            im.alt = '';
            box.appendChild(im);
            e.appendChild(box);
            used += step;
            if (used > TREE.nodeWidth - 35) break;
        }
        const title = el('div', 'rs-node-title');
        e.appendChild(title);
        // _CrashImage (firepower.png) in the bottom-right corner while rushing.
        const crash = el('img', 'rs-node-crash');
        crash.src = chromeImageUrl('firepower.png');
        crash.alt = '';
        crash.hidden = true;
        e.appendChild(crash);
        // 19d3 (scenario `espionageConsequences`): a "stolen" marker on projects acquired by theft.
        const stolen = stolenTechMarker(galaxy, empire, n.def.projectId);
        if (stolen !== '') {
            const m = el('div', 'rs-node-stolen', '(stolen)');
            m.title = stolen;
            e.appendChild(m);
        }
        parent.appendChild(e);
        const nv: NodeView = { node: n, el: e, title, bar: null, barFill: null, crash, key: '' };
        e.addEventListener('mouseenter', () => {
            hovered = n;
            refreshTree();
        });
        e.addEventListener('mouseleave', () => {
            if (hovered === n) hovered = null;
            refreshTree();
        });
        return nv;
    }

    /** DrawBarGraph under a node: (x + 5, y + height − 6), width − 10 × 2, (80, 0, 0, 0) back, (48, 48, 0) → yellow. */
    function ensureBar(nv: NodeView, show: boolean): void {
        if (show && nv.bar === null) {
            const bar = el('div', 'rs-node-bar');
            place(bar, 5, TREE.nodeHeight - 6, TREE.nodeWidth - 10, 2);
            const fill = el('div', 'rs-node-bar-fill');
            bar.appendChild(fill);
            nv.el.appendChild(bar);
            nv.bar = bar;
            nv.barFill = fill;
        } else if (!show && nv.bar !== null) {
            nv.bar.remove();
            nv.bar = nv.barFill = null;
        }
    }

    function applyNode(nv: NodeView, vis: NodeVisual): void {
        const key = `${vis.frame}|${vis.fill}|${vis.enabled}|${vis.border}|${vis.title}|${vis.rushing}|${vis.textColor}`;
        if (key !== nv.key) {
            nv.key = key;
            const e = nv.el;
            e.className = `rs-node rs-frame-${vis.frame} rs-fill-${vis.fill} rs-border-${vis.border}${vis.enabled ? '' : ' rs-disabled'}`;
            e.style.setProperty('--border', `${vis.borderPx}px`);
            setText(nv.title, vis.title);
            nv.title.style.color = vis.textColor;
            nv.title.style.textShadow = `1px 1px 0 ${vis.shadowColor}`;
            nv.crash.hidden = !vis.rushing;
            e.style.cursor = (!nv.node.isResearched && vis.valid && (vis.canResearch || vis.queueIndex >= 0)) ? 'pointer' : 'default';
        }
        ensureBar(nv, vis.progress !== null);
        if (nv.barFill !== null && vis.progress !== null) nv.barFill.style.width = `${Math.trunc(vis.progress * (TREE.nodeWidth - 10))}px`;
    }

    function refreshPaths(): void {
        if (svg === null || ranges === null) return;
        const r = ranges;
        let key = '';
        const lines: string[] = [];
        for (const n of nodes) {
            if (n.parentNodes.length === 0) continue;
            const valid = nodeValidForRace(galaxy, n, race);
            for (let i = 0; i < n.parentNodes.length; i++) {
                const st = pathStyle(n, i, valid);
                key += `${st.color.toString(16)}${st.dashed ? 'd' : ''},`;
                const p = nodePath(n, i, r);
                lines.push(
                    `<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" stroke="${rgbCss(st.color)}" stroke-width="4"` +
                        `${st.dashed ? ' stroke-dasharray="12 4"' : ''} marker-end="url(#rs-arrow-${st.color.toString(16)})"/>`,
                );
            }
        }
        if (key === pathsKey) return;
        pathsKey = key;
        // AdjustableArrowCap(3, 5) on a 4 px pen: 12 px wide, 20 px long, filled in the line colour.
        const colors = [0xff0000, 0x500000, 0xaaaaaa, 0x383838];
        const markers = colors
            .map((c) => `<marker id="rs-arrow-${c.toString(16)}" viewBox="0 0 5 3" refX="5" refY="1.5" markerUnits="strokeWidth" markerWidth="5" markerHeight="3" orient="auto"><path d="M0,0 L5,1.5 L0,3 z" fill="${rgbCss(c)}"/></marker>`)
            .join('');
        svg.innerHTML = `<defs>${markers}</defs>${lines.join('')}`;
    }

    function refreshTree(): void {
        if (content === null || ranges === null) return;
        for (const nv of nodeViews) {
            const valid = nodeValidForRace(galaxy, nv.node, race);
            applyNode(nv, nodeVisual(rs, nv.node, valid, hovered === nv.node, false));
        }
        refreshPaths();
        refreshInfo();
    }

    /** DrawTree → DrawProjectInfo for the hovered node. */
    function refreshInfo(): void {
        if (info === null || view === null || ranges === null) return;
        const n = hovered;
        if (n === null) {
            info.hidden = true;
            infoKey = '';
            return;
        }
        const queue = rs.researchQueueFor(nodeIndustry(n)) ?? [];
        const qi = queue.indexOf(n);
        const key = `${n.def.projectId}|${qi}|${n.isResearched}|${n.isRushing}|${Math.trunc((n.progress / Math.max(1, n.cost)) * 100)}|${rs.canResearchNode(n)}`;
        if (key === infoKey && !info.hidden) return;
        infoKey = key;
        const { allowed, disallowed } = nodeRaces(galaxy, n);
        const count = benefitCount(rs, n);
        const cols = projectInfoColumns(count);
        const height = projectInfoHeight(rs, n, qi, allowed.length, disallowed.length);
        info.replaceChildren();
        // Laid out visible (offsetHeight measures the wrapped lines), shown once placed.
        info.hidden = false;
        info.style.visibility = 'hidden';
        info.style.width = `${cols.width}px`;
        info.style.minHeight = `${height}px`;
        const x0 = 5;
        let y = 5;
        const line = (s: string, cls: string, wrap = false): HTMLDivElement => {
            const d = el('div', `rs-info-line ${cls}`, s);
            if (wrap) d.style.width = `${cols.columnWidth - 10}px`;
            place(d, x0, y);
            info!.appendChild(d);
            return d;
        };
        line(n.def.name, 'rs-info-name');
        y += 20;
        let valid = true;
        if (allowed.length > 0) {
            valid = race !== null && allowed.includes(race);
            line(`(${gt('RACE only', allowed.map((r) => r.name).join(', '))})`.toUpperCase(), 'rs-info-large rs-info-unres');
            y += 20;
        }
        if (disallowed.length > 0) {
            valid = !(race !== null && disallowed.includes(race));
            line(`(${gt('Not RACE', disallowed.map((r) => r.name).join(', '))})`.toUpperCase(), 'rs-info-large rs-info-unres');
            y += 20;
        }
        if (valid) {
            if (!n.isResearched && qi < 0) {
                if (rs.canResearchNode(n)) {
                    line(`(${gt('Click to queue research')})`, 'rs-info-large');
                    y += 20;
                } else {
                    let flag2 = false;
                    const req = n.parentNodes.filter((_, i) => n.parentIsRequired[i]).map((p) => p.def.name);
                    if (req.length > 0) {
                        flag2 = true;
                        const d = line(gt('Must first research PROJECT', req.join(' + ')), 'rs-info-bold rs-info-red', true);
                        y += d.offsetHeight;
                    }
                    if (!n.isEnabled) {
                        const s = n.def.specialFunctionCode === 2 ? gt('Project is disabled. Must enable through exploration') : n.def.specialFunctionCode === 5 ? gt('Project is disabled. Must enable through game event') : '';
                        const d = line(s, 'rs-info-bold rs-info-red', true);
                        y += d.offsetHeight;
                    } else if (!flag2) {
                        line(gt('Must first research preceding project'), 'rs-info-bold rs-info-red');
                        y += 15;
                    }
                }
            } else if (!n.isResearched && qi >= 0) {
                if (n.isRushing) line(`(${gt('Cannot cancel crash programs')})`, 'rs-info-large rs-info-red');
                else line(`(${gt('Right-click to cancel')})`, 'rs-info-large');
                y += 20;
            }
        }
        if (n.isRushing && !n.isResearched) {
            line(gt('CRASH  RESEARCH  (3x speed)'), 'rs-info-large');
            y += 20;
        } else if (qi === 0) {
            line(`(${gt('Click to initiate Crash Program')})`, 'rs-info-large');
            y += 20;
        }
        y += 5;
        let s = gt('Project Size') + ': ' + formatK(n.cost);
        if (n.isResearched) s += '   (' + gt('Completed').toUpperCase() + ')';
        else if (n.progress > 0) s += '   (' + Math.round((n.progress / n.cost) * 100) + '% ' + gt('Complete').toLowerCase() + ')';
        else if (qi > 0) s += '   (' + gt('#X in queue', String(qi + 1)) + ')';
        line(s, `rs-info-large${n.isResearched ? ' rs-info-unres' : ''}`);
        y += 20;
        const columns = generateBenefitDetail(galaxy, empire, rs, n);
        const sep = el('div', 'rs-info-hsep');
        place(sep, x0, y, Math.max(0, cols.columnWidth * columns.length - 10), 1);
        info.appendChild(sep);
        y += 5;
        const numW = cols.columnWidth - cols.valueOffset;
        columns.forEach((col, i) => {
            const x = x0 + i * cols.columnWidth;
            let cy = y;
            if (i < columns.length - 1 && columns.length > 1) {
                const vs = el('div', 'rs-info-vsep');
                place(vs, x + cols.columnWidth - 3, cy, 1, 150);
                info!.appendChild(vs);
            }
            const head = el('div', 'rs-info-line rs-info-bold', col.descriptions[0] ?? '');
            head.style.width = `${cols.columnWidth - 10}px`;
            place(head, x, cy);
            info!.appendChild(head);
            cy += head.offsetHeight;
            for (let k = 1; k < col.descriptions.length; k++) {
                const desc = col.descriptions[k];
                if (desc === null || desc === undefined || desc === '') break;
                const val = col.values[k];
                if (val === null || val === undefined || val === '') {
                    cy += 5;
                    const d = el('div', 'rs-info-line rs-info-normal', desc);
                    d.style.width = `${cols.columnWidth - 10}px`;
                    place(d, x, cy);
                    info!.appendChild(d);
                    cy += d.offsetHeight;
                } else {
                    const l = el('div', 'rs-info-line rs-info-normal ow-right', desc);
                    place(l, x + numW - 5, cy);
                    const vEl = el('div', 'rs-info-line rs-info-bold', val);
                    place(vEl, x + numW, cy);
                    info!.appendChild(l);
                    info!.appendChild(vEl);
                    cy += Math.max(1, l.offsetHeight - 1);
                }
            }
        });
        // Grow to the content (the original's fixed estimate lets long texts run past its black box).
        let bottom = 0;
        for (const ch of Array.from(info.children) as HTMLElement[]) bottom = Math.max(bottom, ch.offsetTop + ch.offsetHeight);
        const h = Math.max(height, bottom + 8);
        info.style.height = `${h}px`;
        const pos = projectInfoPosition(rs, n, ranges, { left: view.scrollLeft, top: view.scrollTop, width: view.clientWidth, height: view.clientHeight }, h);
        info.style.left = `${pos.x}px`;
        info.style.top = `${pos.y}px`;
        info.style.visibility = '';
    }

    /** OnMouseDown / OnMouseMove (drag to scroll) and OnMouseClick (queue / crash / cancel). */
    function wireTreeMouse(v: HTMLDivElement, c: HTMLDivElement, r: TreeRanges): void {
        let drag: { x: number; y: number; l: number; t: number; moved: boolean } | null = null;
        let suppressClick = false;
        const toTree = (e: MouseEvent): { x: number; y: number } => {
            const rect = c.getBoundingClientRect();
            const k = rect.width / Math.max(1, c.offsetWidth);
            return { x: (e.clientX - rect.left) / k, y: (e.clientY - rect.top) / k };
        };
        v.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            drag = { x: e.clientX, y: e.clientY, l: v.scrollLeft, t: v.scrollTop, moved: false };
            suppressClick = false;
        });
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        function onMove(e: PointerEvent): void {
            if (drag === null) return;
            const k = win.scale;
            const dx = (e.clientX - drag.x) / k;
            const dy = (e.clientY - drag.y) / k;
            if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
                drag.moved = true;
                v.classList.add('rs-dragging');
            }
            if (drag.moved) {
                v.scrollLeft = drag.l - dx;
                v.scrollTop = drag.t - dy;
            }
        }
        function onUp(): void {
            if (drag?.moved) suppressClick = true;
            drag = null;
            v.classList.remove('rs-dragging');
        }
        cleanup.push(() => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        });
        v.addEventListener('scroll', () => refreshInfoPosition());
        c.addEventListener('click', (e) => {
            if (suppressClick) {
                suppressClick = false;
                return;
            }
            const p = toTree(e);
            const n = detectNodeAt(nodes, r, p.x, p.y);
            if (n !== null) void clickNode(n, false);
        });
        c.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const p = toTree(e);
            const n = detectNodeAt(nodes, r, p.x, p.y);
            if (n !== null) void clickNode(n, true);
        });
    }

    function refreshInfoPosition(): void {
        if (info === null || info.hidden || hovered === null || view === null || ranges === null) return;
        const pos = projectInfoPosition(rs, hovered, ranges, { left: view.scrollLeft, top: view.scrollTop, width: view.clientWidth, height: view.clientHeight }, info.offsetHeight);
        info.style.left = `${pos.x}px`;
        info.style.top = `${pos.y}px`;
    }

    /** ResearchTree.OnMouseClick outside edit mode. */
    async function clickNode(n: TechNode, right: boolean): Promise<void> {
        if (n.isResearched) return;
        const items = rs.researchQueueFor(nodeIndustry(n)) ?? [];
        const done = (): void => refresh();
        if (!right && !items.includes(n)) {
            if (nodeValidForRace(galaxy, n, race) && rs.canResearchNode(n)) issuePlayerCommand(galaxy, empire, 'queueResearch', [n], done);
        } else if (!right && items.includes(n)) {
            if (items.indexOf(n) === 0 && !n.isRushing) await startCrash(n);
        } else if (right && items.includes(n) && !n.isRushing) {
            issuePlayerCommand(galaxy, empire, 'dequeueResearch', [n], done);
        }
    }

    /** The crash-program question (MessageBoxEx Yes / No) or the cannot-afford notice. */
    async function startCrash(n: TechNode): Promise<void> {
        const cost = calculateCrashResearchProgramCost(empire, n);
        if (empire.stateMoney >= cost) {
            const answer = await messageBox({ caption: gt('Initiate Crash Research Program?'), text: crashQuestion(n.def.name, cost), buttons: ['Yes', 'No'], icon: 'question' });
            if (answer !== 'Yes') return;
            const o = crashResearchOffer(empire, n);
            if (o === null) return;
            issuePlayerCommand(galaxy, empire, 'crashResearch', [n, o.cost], () => refresh());
        } else {
            await messageBox({ caption: gt('Not enough money for Crash Research Program'), text: crashCannotAfford(cost, empire.stateMoney), icon: 'stop' });
        }
    }

    // -----------------------------------------------------------------------------------------------------------
    // Queue panel (ours): the industry's queue at the tree's right edge
    // -----------------------------------------------------------------------------------------------------------

    function buildQueuePanel(frame: HTMLDivElement): void {
        const p = el('div', 'rs-queue');
        frame.appendChild(p);
        queuePanelOpen = queuePanelChoice ?? size.w - 44 >= 1200;
        queuePanel = p;
        queueKey = '';
    }

    function queueStructureKey(): string {
        const q = rs.researchQueueFor(selectedIndustry) ?? [];
        const head = q[0];
        const afford = head ? String(crashResearchOffer(empire, head)?.affordable ?? '-') : '';
        return `${queuePanelOpen}|${q.map((n) => `${n.def.projectId}${n.isRushing ? 'r' : ''}`).join(',')}|${afford}`;
    }

    function refreshQueue(): void {
        const p = queuePanel;
        if (p === null) return;
        const key = queueStructureKey();
        if (key === queueKey) {
            for (const u of queueUpdaters) u();
            return;
        }
        queueKey = key;
        queueUpdaters = [];
        p.replaceChildren();
        p.classList.toggle('rs-queue-closed', !queuePanelOpen);
        const industry = selectedIndustry;
        if (!queuePanelOpen) {
            const handle = el('button', 'rs-queue-handle', 'Research Queue');
            handle.type = 'button';
            handle.title = 'Show the research queue';
            handle.addEventListener('click', (e) => {
                e.stopPropagation();
                queuePanelOpen = queuePanelChoice = true;
                refreshQueue();
            });
            p.appendChild(handle);
            return;
        }
        const head = el('div', 'rs-queue-head');
        head.appendChild(el('div', 'rs-queue-title', 'Research Queue'));
        const hide = glassButton('', { title: 'Hide the research queue', className: 'rs-queue-hide', onClick: () => {
            queuePanelOpen = queuePanelChoice = false;
            refreshQueue();
        } });
        hide.textContent = '▸';
        head.appendChild(hide);
        p.appendChild(head);
        const counts = researchCounts(rs).byIndustry.get(industry) ?? { completed: 0, total: 0 };
        const stats = el('div', 'rs-queue-stats');
        const completed = el('div', '', '');
        const output = el('div', '', '');
        stats.append(el('div', 'rs-queue-industry', gt(industryTabStyle(industry).label)), completed, output);
        const upd = (): void => {
            const c = researchCounts(rs).byIndustry.get(industry) ?? counts;
            setText(completed, `Completed: ${c.completed} / ${c.total}`);
            setText(output, `Output: ${formatMoney(industryOutput(empire, industry))} / yr`);
        };
        upd();
        queueUpdaters.push(upd);
        p.appendChild(stats);
        const list = el('div', 'rs-queue-list ow-scroll');
        const rows = researchQueueRows(rs, industry);
        if (rows.length === 0) list.appendChild(el('div', 'rs-queue-empty', `(${gt('No project')})`));
        for (const row of rows) {
            const line = el('div', `rs-queue-row${row.index === 0 ? ' rs-queue-current' : ''}`);
            const name = el('div', 'rs-queue-name', row.label);
            name.title = row.node.def.name;
            name.addEventListener('click', () => scrollToNode(row.node));
            const bar = el('div', 'rs-queue-bar');
            const fill = el('div', 'rs-queue-bar-fill');
            bar.appendChild(fill);
            const pct = el('div', 'rs-queue-pct');
            const node = row.node;
            const u = (): void => {
                const pr = node.cost <= 0 ? 0 : Math.min(1, Math.max(0, node.progress / node.cost));
                fill.style.width = `${Math.round(pr * 100)}%`;
                setText(pct, formatPercent0(pr));
            };
            u();
            queueUpdaters.push(u);
            const actions = el('div', 'rs-queue-actions');
            if (row.isRushing) {
                const tag = el('div', 'rs-queue-crashtag');
                const im = el('img');
                im.src = chromeImageUrl('firepower.png');
                im.alt = '';
                tag.append(im, el('span', '', 'CRASH'));
                tag.title = gt('CRASH  RESEARCH  (3x speed)');
                actions.appendChild(tag);
            } else if (row.index === 0) {
                const offer = crashResearchOffer(empire, row.node);
                if (offer !== null) {
                    const b = glassButton('', {
                        image: offer.affordable ? 'crashprogram.png' : 'crashprogramdisabled.png',
                        title: `${gt('Initiate Crash Research Program?')} (${formatGrouped(offer.cost)} credits)`,
                        className: 'rs-queue-btn',
                        onClick: () => void startCrash(row.node),
                    });
                    actions.appendChild(b);
                }
            }
            const remove = glassButton('✕', {
                title: row.isRushing ? gt('Cannot cancel crash programs') : 'Remove from queue',
                disabled: row.isRushing,
                className: 'rs-queue-btn',
                onClick: () => issuePlayerCommand(galaxy, empire, 'dequeueResearch', [row.node], () => refresh()),
            });
            actions.appendChild(remove);
            line.append(name, actions, bar, pct);
            list.appendChild(line);
        }
        p.appendChild(list);
    }

    function scrollToNode(n: TechNode): void {
        if (view === null || ranges === null) return;
        const loc = calculateNodeLocation(n, ranges);
        view.scrollTo({ left: Math.max(0, loc.x + TREE.nodeWidth / 2 - view.clientWidth / 2), top: Math.max(0, loc.y + TREE.nodeHeight / 2 - view.clientHeight / 2), behavior: 'smooth' });
    }

    // -----------------------------------------------------------------------------------------------------------
    // Research Stations page (TwUstMvCeX)
    // -----------------------------------------------------------------------------------------------------------

    function buildStations(W: number, H: number): void {
        const panel = gradientPanel({ className: 'rs-stations' });
        place(panel, 13, 115, W - 44, H - 192);
        body.appendChild(panel);

        // ctlResearchFacilities (10, 10) 610 × 320; columns Empire 25, Picture 50, Name 280, Weapons / Energy / HighTech 85.
        const flagCache = new Map<Empire, string>();
        const grid = new OwGrid<BuiltObject>({
            key: (b) => b.builtObjectID,
            rowHeight: 30,
            columns: [
                {
                    id: 'empire',
                    header: '',
                    width: 25,
                    sort: (b) => (b.empire as Empire | null)?.name ?? '',
                    render: (b, cell) => {
                        const emp = b.empire as Empire | null;
                        if (emp === null) return;
                        const im = el('img', 'rs-flag');
                        im.alt = '';
                        im.title = emp.name;
                        const cached = flagCache.get(emp);
                        if (cached) im.src = cached;
                        else
                            void empireFlagUrl(galaxy, emp).then((u) => {
                                flagCache.set(emp, u);
                                im.src = u;
                            });
                        cell.appendChild(im);
                    },
                },
                {
                    id: 'picture',
                    header: '',
                    width: 50,
                    render: (b, cell) => {
                        const u = shipImageUrl(b);
                        if (u === null) return;
                        const im = el('img', 'rs-ship');
                        im.src = u;
                        im.alt = '';
                        im.title = `${b.design?.name ?? ''} (${BuiltObjectSubRole[b.subRole] ?? ''})`;
                        cell.appendChild(im);
                    },
                },
                { id: 'name', header: gt('Name'), width: 280, sort: (b) => b.name, render: (b, cell) => cell.append(b.name) },
                { id: 'w', header: gt('Weapons'), width: 85, align: 'center', sort: (b) => currentResearch(b, b.researchWeapons), render: (b, cell) => cell.append(formatK(currentResearch(b, b.researchWeapons))) },
                { id: 'e', header: gt('Energy'), width: 85, align: 'center', sort: (b) => currentResearch(b, b.researchEnergy), render: (b, cell) => cell.append(formatK(currentResearch(b, b.researchEnergy))) },
                { id: 'h', header: gt('HighTech'), width: 85, align: 'center', sort: (b) => currentResearch(b, b.researchHighTech), render: (b, cell) => cell.append(formatK(currentResearch(b, b.researchHighTech))) },
            ],
            empty: '',
            onDoubleClick: (b) => goTo(b),
        });
        panel.appendChild(place(grid.el, 10, 10, 610, 320));

        // btnResearchGotoFacility (640, 30) 315 × 30.
        const goBtn = glassButton(gt('Go to Research Station'), { onClick: () => {
            const b = grid.selected;
            if (b !== null) goTo(b);
        } });
        panel.appendChild(place(goBtn, 640, 30, 315, 30));

        // lblResearchEmpireLabel (640, 75) font_6 and lblResearchEmpirePotential (825, 73) font_7 on (96, 255, 64, 128).
        panel.appendChild(place(text(gt('Total Empire Research Potential') + ':', { size: FONT.large, color: COLORS.label, shadow: false }), 640, 75));
        const pot = text('', { size: FONT.large, bold: true, color: COLORS.label, shadow: false, className: 'rs-potential' });
        panel.appendChild(place(pot, 825, 73));

        // Government modifier (640, 96) / text (676, 98); race bonus (640, 119) / (676, 121).
        const gov = empireGovernmentAttributes(empire);
        const speed = gov?.researchSpeed ?? 1.0;
        if (empire.pirateEmpireBaseHabitat === null) {
            const govMod = text(formatSignedPercent(speed - 1.0), { size: FONT.large, bold: true, shadow: false, color: speed < 1 ? COLORS.red : speed > 1 ? 'rgb(0, 128, 0)' : COLORS.label });
            panel.appendChild(place(govMod, 640, 96));
            panel.appendChild(place(text(gt('X% from Y government style', '', gov?.name ?? ''), { size: FONT.large, color: COLORS.label, shadow: false }), 676, 98));
        }
        if (empire.researchBonus > 0 && empire.researchBonusRace !== null) {
            panel.appendChild(place(text(formatSignedPercent(empire.researchBonus), { size: FONT.large, bold: true, shadow: false, color: 'rgb(0, 128, 0)' }), 640, 119));
            panel.appendChild(place(text(gt('X% from Y race', '', empire.researchBonusRace.name), { size: FONT.large, color: COLORS.label, shadow: false }), 676, 121));
        }
        // lblResearchMaximumSize (640, 150) max 290 wide; lblResearchEmpireSpecialBonuses (640, 195) max 315 × 255.
        const maxSize = text('', { size: FONT.large, color: COLORS.label, shadow: false, wrapWidth: 290 });
        panel.appendChild(place(maxSize, 640, 150));
        const special = text('', { size: FONT.large, color: COLORS.label, shadow: false, wrapWidth: 315 });
        special.classList.add('rs-special');
        panel.appendChild(place(special, 640, 195, 315, 255));

        // pnlResearchSummary (50, 330) 570 × 60.
        const sum = gradientPanel({ className: 'rs-summary', border: null });
        panel.appendChild(place(sum, 50, 330, 570, 60));
        const band = el('div', 'rs-summary-band');
        place(band, 8, 33, 570 - 20, 14 + 8);
        sum.appendChild(band);
        const tf = { size: FONT.normal + 2, bold: true, color: COLORS.label };
        sum.appendChild(place(text(gt('Total Research Capacity'), tf), 10, 10));
        sum.appendChild(place(text(gt('Actual Output (including bonuses)'), tf), 10, 33));
        const vals = [335, 420, 505].map((x) => [place(text('', tf), x, 10), place(text('', tf), x, 33)]);
        for (const [a, b] of vals) sum.append(a, b);

        stationsRefresh = (): void => {
            grid.setRows(researchFacilities(empire));
            setText(pot, formatK(annualResearchPotential(empire)));
            setText(maxSize, maximumSizeText(empire));
            setText(special, summarizeSpecialResearchBonuses(empire));
            const fields = [IndustryType.Weapon, IndustryType.Energy, IndustryType.HighTech];
            fields.forEach((ind, i) => {
                setText(vals[i][0], formatK(researchPotential(empire, ind)));
                setText(vals[i][1], formatK(researchOutput(empire, ind)));
            });
        };
    }

    /** btnResearchGotoFacility_Click: select and zoom to the station, close the screen. */
    function goTo(b: BuiltObject): void {
        selectStellarObject(b, true);
        win.close();
    }

    // -----------------------------------------------------------------------------------------------------------
    // Refresh (ResearchTree's 100 ms repaint; method_397 → method_398 after clicks)
    // -----------------------------------------------------------------------------------------------------------

    function refresh(): void {
        for (const t of tabs) if (t.industry !== IndustryType.Undefined) setButtonMinorText(t.btn, currentProjectText(rs, t.industry));
        if (selectedIndustry === IndustryType.Undefined) {
            if (tick % 8 === 0) stationsRefresh?.();
        } else {
            refreshTree();
            refreshQueue();
        }
        tick++;
    }

    const cleanup: (() => void)[] = [];
    build();
    // Worker mode: bring what the screen shows up to date now instead of up to a cold cycle later (no-op in-thread).
    requestSimRefresh(galaxy, [empire, empire.research], () => {
        if (!win.closed) refresh();
    });
    timer = window.setInterval(() => {
        if (win.closed) return;
        refresh();
    }, 250);

    const close = (): void => win.close();
    return { win, close };
}
