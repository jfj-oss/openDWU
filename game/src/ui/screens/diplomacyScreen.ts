// Diplomacy screen (task 15a): a streamlined Diplomacy panel opened with F5.
// One row per empire the player has met; the selected row shows the current
// relation, the treaty on offer (Accept Offer / Decline), the player's own
// outgoing offer, the player's automated strategy, side treaties and how that
// empire feels about the player with its factor breakdown.
// Sources:
// - DistantWorlds.Controls/Controls/EmpireDetailView.cs:573-608 (relation +
//   colour), :639-706 (treaty on offer), :733-757 (attitude block), :803
//   btnEmpireDetailAcceptTreaty_Click (accept);
// - DistantWorlds.Types/Empire.4.cs:55 ResolveFeelingDescription;
// - DistantWorlds.Types/Empire.7.cs:4164 DetermineEmpireRelationshipFactors;
// - DistantWorlds.Types/Empire.10.cs:681 CivilityDescription;
// - DistantWorlds/Main.Part10.cs:3930 method_235 (remove a proposal / decline).
// This is not the original 1:1 EmpireDetailView: no race portrait, no
// ambassador card, no conversation dialogs, no trade screen.
// Proposals (task 17e): the player's conversation options (Main.Part9.cs:46 method_238 / Main.Part10.cs:3957 method_237,
// sim/player/diplomacyProposals.ts) as a compact "Propose..." list on the selected empire, with the reply inline.
// TODO(port): pirate relations (Empire.7.cs:4270 pirate branch), ambassador card (EmpireDetailView.cs:613) — not in 15a

import './diplomacyScreen.css';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { EmpireMessage } from '../../sim/messages';
import { getGovernmentsStatic, AutomationLevel } from '../../sim/empire';
import { displayColorForEmpire } from '../../sim/empireColors';
import {
    DiplomaticRelation,
    DiplomaticRelationType,
    DiplomaticStrategy,
    empireEvaluationByEmpire,
    empireEvaluationsOf,
} from '../../sim/diplomacy';
import {
    cancelBlockades,
    changeDiplomaticRelation,
    determineDesiredDiplomaticRelationTypical,
    processEndOfWarWithEmpire,
    resetAttitudeLevelsAtEndOfWar,
    MANUAL,
} from '../../sim/diplomacyTick';
import { galaxyStarDate } from '../../sim/tick/simTime';
import { applyEmpireEmblem } from '../empireEmblem';
import { leagueSection } from '../leagueRows';
import { rimTraderTermsRows, type RimTraderTermsRows } from '../scenario/rimTraderRows';
import { rimTraderEmpire } from '../../sim/scenario/rimTrade/common';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../../sim/galaxyTime';
import { EmpireMessageType, empireMessages } from '../../sim/messages';
import { showToast } from '../toast';
// [proposals] begin
import { listProposals, type ProposalOption, type ProposalResult } from '../../sim/player/diplomacyProposals';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { companyHeaderLine, toggleChartersScreen } from './charters'; // [charters]
import { charterOfCompany } from '../../sim/scenario/charteredCompanies/charters'; // [charters]
import { DialogSet, raceDialogFileName } from '../../sim/data/dialogSet';
import { fetchText } from '../../sim/data/fetchData';
import { resolveDataUrl } from '../../sim/data/paths';
import { formatNet, resolveGameText } from '../../sim/textResolver';
// [proposals] end

// [tradenego] begin
import { closeTradePanel, openTradePanel } from './tradePanel';
import type { DialogPartType } from '../../sim/data/dialogSet';
// [tradenego] end

// [wargoals] begin
import { warRowSuffix, warTermsBlock } from './warTermsPanel';
// [wargoals] end

// [diplovoice] begin
import { counterNote, diplomatVoiceConfig, voiceDiplomatReply, voiceSwitch, voicedLineToggle, voicingIndicator, type VoicedReply } from '../diplomatVoice';
// [diplovoice] end

/** EmpireDetailView relation colours (_NotMetColor … _TruceColor). */
export const RELATION_COLORS: Record<DiplomaticRelationType, number> = {
    [DiplomaticRelationType.NotMet]: 0xd2b48c, // Color.Tan
    [DiplomaticRelationType.None]: 0x808080,
    [DiplomaticRelationType.FreeTradeAgreement]: 0x00ff00,
    [DiplomaticRelationType.MutualDefensePact]: 0x4040e8,
    [DiplomaticRelationType.SubjugatedDominion]: 0xffff00, // Color.Yellow
    [DiplomaticRelationType.Protectorate]: 0x7070ff,
    [DiplomaticRelationType.TradeSanctions]: 0xffa500, // Color.Orange
    [DiplomaticRelationType.War]: 0xff0000,
    [DiplomaticRelationType.Truce]: 0xffff00, // Color.Yellow
};

/** Galaxy.2.cs:2488 ResolveDescription(DiplomaticRelationType) (GameText.txt:1860-1868). */
export function relationTypeLabel(type: DiplomaticRelationType): string {
    switch (type) {
        case DiplomaticRelationType.NotMet: return 'Not Met';
        case DiplomaticRelationType.None: return 'No relationship';
        case DiplomaticRelationType.FreeTradeAgreement: return 'Free Trade Agreement';
        case DiplomaticRelationType.MutualDefensePact: return 'Mutual Defense Pact';
        case DiplomaticRelationType.SubjugatedDominion: return 'Subjugated Dominion';
        case DiplomaticRelationType.Protectorate: return 'Protectorate';
        case DiplomaticRelationType.TradeSanctions: return 'Trade Sanctions';
        case DiplomaticRelationType.War: return 'War';
        case DiplomaticRelationType.Truce: return 'Truce';
    }
    return '';
}

/** EmpireDetailView.cs:573-608 text11: the label plus the Subjugated / Protectorate suffix. */
export function relationDescription(rel: DiplomaticRelation, player: Empire): string {
    let text = relationTypeLabel(rel.type);
    switch (rel.type) {
        case DiplomaticRelationType.SubjugatedDominion:
            text = rel.initiator !== player ? `${text} (They subjugate us)` : `${text} (We subjugate them)`;
            break;
        case DiplomaticRelationType.Protectorate:
            text = rel.initiator !== player ? `${text} (They protect us)` : `${text} (We protect them)`;
            break;
    }
    return text;
}

/** C# ToString("+0;-0;0"): round half away from zero, then '+N', '-N' or '0'. */
export function formatSigned(v: number): string {
    const n = Math.sign(v) * Math.round(Math.abs(v));
    if (n > 0) return `+${n}`;
    if (n < 0) return `-${-n}`;
    return '0';
}

// Moved to sim/player/relationFactors.ts (shared with the 18b diplomat brief).
export { feelingDescription, civilityDescription, relationshipFactors, type RelationshipFactor } from '../../sim/player/relationFactors';
import { relationshipFactors, feelingDescription, type RelationshipFactor } from '../../sim/player/relationFactors';
import { incidentRows } from '../../sim/scenario/emergent/espionageView';
import { councilView } from '../../sim/scenario/emergent/councilView';
import { reputationRows } from '../../sim/scenario/reputation/view';
import { activeVoiceJob } from '../../llm/voiceJob'; // [llm] 19s-2
import { acceptProposal, declineProposal } from '../../sim/player/playerOrders';
export { acceptProposal, declineProposal };

/** EmpireDetailView.cs:639-706 flag3: is the other empire's offer still open?
 * The C# also removes invalid proposals while drawing; the panel does not (no
 * mutation on render). The sim's considerTreatyProposals clears them. */
export function isProposalValid(proposal: DiplomaticRelation, other: Empire, player: Empire, starDate: number): boolean {
    const validMs = Math.trunc(0.2 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000); // Galaxy.TreatyOfferValidYears (Galaxy.3.cs:5059)
    if (starDate > proposal.lastDiplomacyTradeOfferDate + validMs) return false;
    const theirs = other.diplomaticRelations.byEmpire(player);
    // A missing relation matches the fresh NotMet relation ObtainDiplomaticRelation would add.
    const strategy = theirs ? theirs.strategy : DiplomaticStrategy.Undefined;
    const type = theirs ? theirs.type : DiplomaticRelationType.NotMet;
    if (determineDesiredDiplomaticRelationTypical(strategy, type) !== proposal.type) return false;
    return true;
}

/** EmpireDetailView.cs:639-706 text14: the label of a treaty on offer. */
export function proposalLabel(proposalType: DiplomaticRelationType, current: DiplomaticRelation | null, player: Empire): string {
    const currentType = current ? current.type : DiplomaticRelationType.NotMet;
    switch (proposalType) {
        case DiplomaticRelationType.None:
            switch (currentType) {
                case DiplomaticRelationType.FreeTradeAgreement:
                case DiplomaticRelationType.MutualDefensePact:
                case DiplomaticRelationType.Protectorate:
                    return 'Cancelling Treaty';
                case DiplomaticRelationType.SubjugatedDominion:
                    if (current!.initiator === player) return 'Request release from Subjugation';
                    return 'Offering release from Subjugation';
                case DiplomaticRelationType.TradeSanctions:
                    return 'Lifting Trade Sanctions';
                case DiplomaticRelationType.War:
                    return 'Ending War';
                case DiplomaticRelationType.Truce:
                    return 'Peace Treaty';
            }
            return '';
        default:
            return relationTypeLabel(proposalType);
    }
}

export interface DiplomacyRow {
    empire: Empire;
    name: string;
    color: number;
    relationType: DiplomaticRelationType;
    relationText: string;
    relationColor: number;
    attitude: number | null;
    feeling: string;
    ourStrategy: string;
    treaties: string[];
    incoming: DiplomaticRelation | null;
    incomingText: string;
    incomingMessage: string;
    outgoing: DiplomaticRelation | null;
    outgoingText: string;
    factors: RelationshipFactor[];
}

function strategyLabel(strategy: DiplomaticStrategy): string {
    if (strategy === DiplomaticStrategy.Undefined) return '(None)';
    const name = DiplomaticStrategy[strategy] ?? '';
    return name.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Rows for the panel: every met, active, non-pirate, non-independent empire, sorted by name. */
export function diplomacyRows(player: Empire, starDate: number, playerGovernmentName: string): DiplomacyRow[] {
    const rels: DiplomaticRelation[] = [];
    for (const rel of player.diplomaticRelations) {
        if (rel.type === DiplomaticRelationType.NotMet) continue;
        const other = rel.otherEmpire;
        if (other === null || !other.active) continue;
        if (other === player.galaxy.independentEmpire) continue;
        if (other.pirateEmpireBaseHabitat !== null) continue;
        rels.push(rel);
    }
    rels.sort((a, b) => a.otherEmpire!.name.localeCompare(b.otherEmpire!.name));

    return rels.map((rel) => {
        const other = rel.otherEmpire!;
        const ev = empireEvaluationByEmpire(empireEvaluationsOf(other), player);
        const attitude = ev ? ev.overallAttitude : null;
        const feeling = ev && attitude !== null ? `${feelingDescription(attitude)} with us (${formatSigned(attitude)})` : '';
        const theirs = other.diplomaticRelations.byEmpire(player);

        const treaties: string[] = [];
        if (rel.militaryRefuelingToOther) treaties.push('We allow them military refueling');
        if (theirs?.militaryRefuelingToOther) treaties.push('They allow us military refueling');
        if (rel.miningRightsToOther) treaties.push('We grant them mining rights');
        if (theirs?.miningRightsToOther) treaties.push('They grant us mining rights');
        if (rel.supplyRestrictedResources) treaties.push('Restricted resources traded');

        let incoming = player.proposedDiplomaticRelations.byEmpire(other);
        if (incoming !== null && !isProposalValid(incoming, other, player, starDate)) incoming = null;
        let incomingText = '';
        let incomingMessage = '';
        if (incoming !== null) {
            incomingText = proposalLabel(incoming.type, rel, player);
            const msgs: EmpireMessage[] = empireMessages(player);
            for (let i = msgs.length - 1; i >= 0; i--) {
                const m = msgs[i];
                if (m.sender === other && m.messageType === EmpireMessageType.ProposeDiplomaticRelation && m.subject === incoming.type) {
                    incomingMessage = m.description;
                    break;
                }
            }
        }

        const outgoing = other.proposedDiplomaticRelations.byEmpire(player);
        const outgoingText = outgoing !== null ? proposalLabel(outgoing.type, rel, player) : '';

        return {
            empire: other,
            name: other.name,
            // Task 19k-1b: the big-galaxies scenario's extendedPalette flag substitutes a distinct colour for
            // empires beyond the 20 key colours; off (or no scenario) this is exactly other.mainColor.
            color: displayColorForEmpire(other),
            relationType: rel.type,
            relationText: relationDescription(rel, player),
            relationColor: RELATION_COLORS[rel.type],
            attitude,
            feeling,
            ourStrategy: strategyLabel(rel.strategy),
            treaties,
            incoming,
            incomingText,
            incomingMessage,
            outgoing,
            outgoingText,
            factors: relationshipFactors(player, other, playerGovernmentName),
        };
    });
}

/** Task 19k-1d (Big Galaxies: 60-empire games): case-insensitive substring filter on empire name, for the list
 * pane's filter box — at 60 empires the plain list is long, so a filter is the fast way to find one. An
 * empty/blank query keeps every row. */
export function filterDiplomacyRows(rows: DiplomacyRow[], query: string): DiplomacyRow[] {
    const q = query.trim().toLowerCase();
    if (q === '') return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
}

/** The player's GovernmentAttributes.Name. */
export function playerGovernmentName(player: Empire): string {
    if (player.governmentId < 0) return '';
    return getGovernmentsStatic()[player.governmentId]?.name ?? '';
}

// [proposals] begin
export interface ProposalGroup {
    /** The greeting-menu entry (GameText key, resolveGameText for display). */
    label: string;
    options: ProposalOption[];
}

/** Main.Part9.cs:208-249 greeting menu: listProposals' options grouped under their menu entry, in list order. */
export function proposalGroups(options: readonly ProposalOption[]): ProposalGroup[] {
    const groups: ProposalGroup[] = [];
    for (const o of options) {
        let g = groups.find((x) => x.label === o.menuLabel);
        if (!g) {
            g = { label: o.menuLabel, options: [] };
            groups.push(g);
        }
        g.options.push(o);
    }
    return groups;
}

/** Main.Part10.cs:3590 method_230: the reply line, string.Format(dialogSet.ResolveDialog(type, race), args); a refused
 *  submit shows its hint; null set = dialog files not loaded yet. */
export function proposalReplyText(set: DialogSet | null, result: ProposalResult, raceName: string): string {
    if (!result.ok) return result.message;
    if (result.reply === null) return '';
    if (set === null) return '…';
    return formatNet(set.resolveDialog(result.reply, raceName), result.replyArgs);
}

let expireDiplomacyMessages: ((empire: Empire) => void) | null = null;

/** messagePopups (16d) registers its conversation queue's ExpireDiplomacyMessagesForEmpire here. */
export function setDiplomacyMessageExpiry(fn: ((empire: Empire) => void) | null): void {
    expireDiplomacyMessages = fn;
}

// DialogSet.cs:21 Initialize: base_dialog.txt plus the race's file, loaded on first use.
let dialogLoad: Promise<DialogSet | null> | null = null;
const raceDialogLoads = new Map<string, Promise<void>>();
function loadDialogSet(raceName: string): Promise<DialogSet | null> {
    dialogLoad ??= fetchText(resolveDataUrl('dialog/base_dialog.txt'))
        .then((t) => new DialogSet(t))
        .catch(() => null);
    return dialogLoad.then((set) => {
        if (set === null || raceName === '' || set.hasRace(raceName)) return set;
        let p = raceDialogLoads.get(raceName);
        if (!p) {
            p = fetchText(resolveDataUrl(`dialog/${raceDialogFileName(raceName)}`))
                .then((t) => set.addRace(raceName, t))
                .catch(() => undefined);
            raceDialogLoads.set(raceName, p);
        }
        return p.then(() => set);
    });
}
// [proposals] end

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

export interface DiplomacyScreenOptions {
    player: Empire;
    /** Select this empire's row on open; if the screen is already open, re-select it instead of closing (16d "Open
     *  diplomacy" button on a pirate offer popup / Main.Part8.cs:449 method_296, which always brought that empire's
     *  talk panel to the front rather than toggling it closed). */
    selectedEmpire?: Empire;
}

interface OpenState {
    root: HTMLElement;
    close: () => void;
    select: (empire: Empire) => void;
}

let open: OpenState | null = null;

/** Open the Diplomacy screen, or close it if it is already open. With `selectedEmpire`, an already-open screen
 *  selects that empire instead of closing (see DiplomacyScreenOptions). */
export function toggleDiplomacyScreen(opts: DiplomacyScreenOptions): void {
    if (open) {
        if (opts.selectedEmpire) {
            open.select(opts.selectedEmpire);
            return;
        }
        open.close();
    } else {
        open = createDiplomacyScreen(opts);
    }
}

/** Close the Diplomacy screen (no-op when closed). */
export function closeDiplomacyScreen(): void {
    open?.close();
}

function rgb(c: number): string {
    return `rgb(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255})`;
}

const LIGHT_GREEN = '#90ee90';
const RED = '#ff0000';

function el(tag: string, className: string, text?: string): HTMLElement {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

// [rimTrader] begin
/** Scenario 19a: the Concord (rim trader) of the player's galaxy, or null. */
function rimTraderEmpireOf(player: Empire): Empire | null {
    return player.galaxy != null && player.galaxy.scenario !== null ? rimTraderEmpire(player.galaxy) : null;
}

/** Scenario 19a (tasks/19a-rim-trader.md §8.1): the Concord's "Trade terms" block. */
function rimTraderTermsBlock(t: RimTraderTermsRows): HTMLElement {
    const box = el('div', 'diplomacy-rimterms');
    box.appendChild(el('div', 'diplomacy-section-heading', t.title));
    const goods = (label: string, rows: RimTraderTermsRows['wanted']): HTMLElement => {
        const line = el('div', 'diplomacy-rimterms-goods');
        line.appendChild(el('span', 'diplomacy-rimterms-label', label));
        for (const g of rows) {
            const item = el('span', 'diplomacy-rimterms-good');
            const img = document.createElement('img');
            img.src = g.iconUrl;
            img.alt = g.name;
            item.append(img, el('span', '', g.name));
            line.appendChild(item);
        }
        return line;
    };
    box.appendChild(goods(t.lines[0].label, t.wanted));
    box.appendChild(goods(t.lines[1].label, t.offered));
    for (const l of t.lines.slice(2)) {
        const line = el('div', 'diplomacy-rimterms-line');
        line.append(el('span', 'diplomacy-rimterms-label', l.label), el('span', 'diplomacy-rimterms-value', l.value));
        box.appendChild(line);
    }
    const access = box.lastElementChild?.querySelector<HTMLElement>('.diplomacy-rimterms-value');
    if (access) access.style.color = t.open ? LIGHT_GREEN : RED;
    box.appendChild(el('div', 'diplomacy-line diplomacy-muted', t.where));
    box.appendChild(el('div', 'diplomacy-line diplomacy-muted', `${t.noWar} ${t.treaties}`));
    return box;
}
// [rimTrader] end

/** 19r: an emblem image (stock art at once, the override when ready); removed if it fails to load. The Concord's
 * junk-mask portrait/flag (19a) reaches this through the registerEmblemOverride hook in render/concordArt.ts. */
function emblemImg(className: string, empire: Empire, which: 'portrait' | 'flag', style: string): HTMLImageElement {
    const img = document.createElement('img');
    img.className = className;
    img.alt = '';
    img.draggable = false;
    img.style.cssText = style;
    img.addEventListener('error', () => img.remove());
    applyEmpireEmblem(img, empire.galaxy, empire, which);
    return img;
}

function createDiplomacyScreen(opts: DiplomacyScreenOptions): OpenState {
    const root = el('div', 'diplomacy-wrap');
    const win = el('div', 'diplomacy-window');

    const titlebar = el('div', 'diplomacy-titlebar');
    titlebar.appendChild(el('div', 'diplomacy-heading', 'Diplomacy'));
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'diplomacy-close';
    closeBtn.title = 'Close';
    closeBtn.textContent = '✕';
    titlebar.appendChild(closeBtn);
    win.appendChild(titlebar);

    const body = el('div', 'diplomacy-body');
    win.appendChild(body);
    root.appendChild(win);
    document.body.appendChild(root);

    let selected: Empire | null = opts.selectedEmpire ?? null;
    let listScroll = 0;
    let detailScroll = 0;
    // Task 19k-1d (Big Galaxies: 60-empire games): a filter box on the list pane, so a 60-empire list stays usable.
    let filterQuery = '';

    function render(): void {
        const listPane = body.querySelector<HTMLElement>('.diplomacy-list');
        const detailPane = body.querySelector<HTMLElement>('.diplomacy-detail');
        if (listPane) listScroll = listPane.scrollTop;
        if (detailPane) detailScroll = detailPane.scrollTop;
        const prevFilterEl = body.querySelector<HTMLInputElement>('.diplomacy-filter');
        const filterWasFocused = document.activeElement === prevFilterEl;
        const filterCaret = prevFilterEl?.selectionStart ?? null;
        body.replaceChildren();

        const player = opts.player;
        const rows = diplomacyRows(player, galaxyStarDate(player.galaxy), playerGovernmentName(player));
        if (rows.length === 0) {
            body.classList.add('diplomacy-body-empty');
            body.appendChild(el('div', 'diplomacy-empty', 'No empires met yet'));
            return;
        }
        body.classList.remove('diplomacy-body-empty');
        let row = rows.find((r) => r.empire === selected);
        if (!row) {
            row = rows[0];
            selected = row.empire;
        }

        const list = el('div', 'diplomacy-list');
        const filterInput = document.createElement('input');
        filterInput.type = 'text';
        filterInput.className = 'diplomacy-filter';
        filterInput.placeholder = 'Filter empires…';
        filterInput.autocomplete = 'off';
        filterInput.value = filterQuery;
        filterInput.addEventListener('input', () => {
            filterQuery = filterInput.value;
            render();
        });
        list.appendChild(filterInput);

        const filteredRows = filterDiplomacyRows(rows, filterQuery);
        if (filteredRows.length === 0) {
            list.appendChild(el('div', 'diplomacy-list-empty', 'No empires match this filter.'));
        }
        for (const r of filteredRows) {
            const line = el('div', r === row ? 'diplomacy-row diplomacy-row-selected' : 'diplomacy-row');
            const swatch = el('span', 'diplomacy-swatch');
            swatch.style.background = rgb(r.color);
            const name = el('span', 'diplomacy-name', r.name);
            name.title = r.name;
            const relation = el('span', 'diplomacy-relation', r.relationText + warRowSuffix(player, r.empire)); // [wargoals]
            relation.style.color = rgb(r.relationColor);
            relation.title = r.relationText;
            const attitude = el('span', 'diplomacy-attitude', r.attitude !== null ? formatSigned(r.attitude) : '');
            if (r.attitude !== null) attitude.style.color = r.attitude < 0 ? RED : LIGHT_GREEN;
            line.append(swatch, name, relation, attitude);
            line.addEventListener('click', () => {
                selected = r.empire;
                detailScroll = 0;
                render();
            });
            list.appendChild(line);
        }

        const detail = el('div', 'diplomacy-detail');
        const title = el('div', 'diplomacy-detail-title');
        const tSwatch = el('span', 'diplomacy-swatch');
        tSwatch.style.background = rgb(row.color);
        title.append(tSwatch, el('span', 'diplomacy-detail-name', row.name));
        // 19r: the empire's portrait and flag (derived / scenario art through the emblem overrides — the 19a
        // Concord's mask reaches this through render/concordArt.ts's registerEmblemOverride hook).
        title.prepend(emblemImg('diplomacy-portrait', row.empire, 'portrait', 'width:48px;height:48px;margin-right:8px;border-radius:3px;vertical-align:middle'));
        title.append(emblemImg('diplomacy-flag', row.empire, 'flag', 'width:40px;height:24px;margin-left:8px;vertical-align:middle'));
        detail.appendChild(title);

        detail.appendChild(el('div', 'diplomacy-section-heading', 'Current Relationship With Us'));
        const relText = el('div', 'diplomacy-line', row.relationText);
        relText.style.color = rgb(row.relationColor);
        detail.appendChild(relText);
        // [charters] begin
        // Scenario 19c: a company's charter line; its founder gets a "Manage charter" link (§8.4).
        const charterLine = companyHeaderLine(player.galaxy, row.empire);
        if (charterLine !== '') {
            detail.appendChild(el('div', 'diplomacy-line', charterLine));
            const charter = charterOfCompany(player.galaxy, row.empire);
            if (charter !== null && charter.founderId === player.empireId) {
                const manage = el('button', 'diplomacy-button', 'Manage charter') as HTMLButtonElement;
                manage.type = 'button';
                manage.addEventListener('click', () => toggleChartersScreen(player.galaxy, player));
                detail.appendChild(manage);
            }
        }
        // [charters] end

        // [rimTrader] begin
        const rimTerms = row.empire === rimTraderEmpireOf(player) ? rimTraderTermsRows(player.galaxy, player) : null;
        if (rimTerms !== null) detail.appendChild(rimTraderTermsBlock(rimTerms));
        // [rimTrader] end

        // [wargoals] begin
        const war = warTermsBlock(player, row.empire, () => render());
        if (war !== null) detail.appendChild(war);
        // [wargoals] end

        detail.appendChild(el('div', 'diplomacy-section-heading', 'Treaty on Offer'));
        if (row.incoming) {
            detail.appendChild(el('div', 'diplomacy-line', row.incomingText));
            if (row.incomingMessage) detail.appendChild(el('div', 'diplomacy-message', row.incomingMessage));
            const buttons = el('div', 'diplomacy-buttons');
            const accept = el('button', 'diplomacy-button', 'Accept Offer') as HTMLButtonElement;
            accept.type = 'button';
            const decline = el('button', 'diplomacy-button', 'Decline') as HTMLButtonElement;
            decline.type = 'button';
            const other = row.empire;
            accept.addEventListener('click', () => {
                issuePlayerCommand(player.galaxy, player, 'acceptProposal', [other], (ok) => {
                    if (ok) showToast('Treaty accepted');
                    render();
                });
            });
            decline.addEventListener('click', () => {
                issuePlayerCommand(player.galaxy, player, 'declineProposal', [other], () => render());
            });
            buttons.append(accept, decline);
            detail.appendChild(buttons);
        } else {
            detail.appendChild(el('div', 'diplomacy-line diplomacy-muted', '(none)'));
        }

        detail.appendChild(el('div', 'diplomacy-section-heading', 'Our offer to them'));
        detail.appendChild(
            row.outgoing
                ? el('div', 'diplomacy-line', row.outgoingText)
                : el('div', 'diplomacy-line diplomacy-muted', '(none)'),
        );

        // [proposals] begin
        detail.appendChild(proposalsBlock(player, row.empire));
        // [proposals] end

        detail.appendChild(el('div', 'diplomacy-line diplomacy-strategy', `Our strategy: ${row.ourStrategy}`));

        if (row.treaties.length > 0) {
            detail.appendChild(el('div', 'diplomacy-section-heading', 'Treaties'));
            const ul = el('ul', 'diplomacy-treaties');
            for (const t of row.treaties) ul.appendChild(el('li', 'diplomacy-treaty', t));
            detail.appendChild(ul);
        }

        if (row.feeling) {
            detail.appendChild(el('div', 'diplomacy-section-heading', 'Attitude'));
            const feeling = el('div', 'diplomacy-line diplomacy-feeling', row.feeling);
            if (row.attitude !== null) feeling.style.color = row.attitude < 0 ? RED : LIGHT_GREEN;
            detail.appendChild(feeling);
        }
        for (const f of row.factors) {
            const line = el('div', 'diplomacy-factor', `${f.description} (${formatSigned(f.value)})`);
            line.style.color = f.value < 0 ? RED : LIGHT_GREEN;
            detail.appendChild(line);
        }

        // 19o (scenario `reputationLedger`): the ledger entries the other empire holds about us, with their fade.
        const causes = reputationRows(player.galaxy, player, row.empire);
        if (causes.length > 0) {
            detail.appendChild(el('div', 'diplomacy-section-heading', 'Why they feel this way'));
            for (const r of causes) {
                const line = el('div', 'diplomacy-factor', r.text);
                line.style.color = r.value < 0 ? RED : LIGHT_GREEN;
                detail.appendChild(line);
            }
        }

        // 19d3 (scenario `espionageConsequences`): open espionage crises, recent exposures, stolen techs of the pair.
        const incidents = incidentRows(player.galaxy, player, row.empire);
        if (incidents.length > 0) {
            detail.appendChild(el('div', 'diplomacy-section-heading', 'Incidents'));
            for (const r of incidents) {
                const line = el('div', 'diplomacy-factor', r.text);
                if (r.kind === 'crisis') line.style.color = RED;
                detail.appendChild(line);
            }
        }

        // 19d8 (scenario `galacticCouncil`): the council block — members, chair, motion on the floor, last 5 results, our bloc.
        const council = councilView(player.galaxy, player);
        if (council !== null) {
            detail.appendChild(el('div', 'diplomacy-section-heading', council.observer ? `Council: ${council.name} (not a member)` : `Council: ${council.name}`));
            detail.appendChild(el('div', 'diplomacy-line', `Chair: ${council.chair || '(none)'} — founded ${council.founded}`));
            for (const mr of council.members) {
                const tags = [mr.chair ? 'chair' : '', mr.bloc, `prestige ${mr.prestige}`, mr.losses > 0 ? `outvoted ${mr.losses}` : ''].filter((t) => t !== '').join(', ');
                detail.appendChild(el('div', 'diplomacy-factor', `${mr.name} (${tags})`));
            }
            detail.appendChild(el('div', 'diplomacy-line', council.motion !== '' ? `Motion: ${council.motion}` : 'Motion: (none on the floor)'));
            if (council.motionStatus !== '') detail.appendChild(el('div', 'diplomacy-factor', council.motionStatus));
            // [llm] 19s-2 voices: two members speak for / against the motion (scripted at once, voiced in place).
            const speeches = council.motionRef !== null ? activeVoiceJob()?.councilSpeeches(council.councilRef!, council.motionRef, () => render()) ?? null : null;
            if (speeches !== null) {
                for (const sp of [speeches.for, speeches.against]) {
                    if (sp === null) continue;
                    const line = el('div', 'diplomacy-factor', `${sp.side === 'for' ? 'For' : 'Against'} — ${sp.speaker.name}: ${sp.text}`);
                    line.style.color = sp.side === 'for' ? LIGHT_GREEN : RED;
                    if (sp.voiced) line.title = 'Voiced by the local model';
                    detail.appendChild(line);
                }
            }
            if (council.voteDecisionId > 0) {
                const buttons = el('div', 'diplomacy-line');
                for (const [id, label] of [['yes', 'Vote yes'], ['no', 'Vote no'], ['abstain', 'Abstain']] as const) {
                    const b = el('button', 'diplomacy-button', label) as HTMLButtonElement;
                    b.type = 'button';
                    b.addEventListener('click', () => issuePlayerCommand(player.galaxy, player, 'answerScenarioDecision', [council.voteDecisionId, id], () => render()));
                    buttons.appendChild(b);
                }
                detail.appendChild(buttons);
            }
            for (const r of council.results) {
                const line = el('div', 'diplomacy-factor', r.text);
                line.style.color = r.passed ? LIGHT_GREEN : RED;
                detail.appendChild(line);
            }
            detail.appendChild(el('div', 'diplomacy-line', `Our bloc: ${council.yourBloc || '(none)'}`));
            if (council.rivals.length > 0) detail.appendChild(el('div', 'diplomacy-line diplomacy-muted', `Rival council: ${council.rivals.join(', ')}`));
        }

        // 19r: the independent leagues (19k-3) with their flags, under the empire rows.
        const leagues = leagueSection(player.galaxy, 'diplomacy');
        if (leagues !== null) list.appendChild(leagues);
        body.append(list, detail);
        list.scrollTop = listScroll;
        detail.scrollTop = detailScroll;
        // Rebuilding the list (above) replaces the filter <input> too; restore focus/caret so typing a filter query
        // does not lose keyboard focus on every keystroke.
        if (filterWasFocused) {
            filterInput.focus();
            if (filterCaret !== null) filterInput.setSelectionRange(filterCaret, filterCaret);
        }
    }

    // [proposals] begin
    // The "Propose..." block is rebuilt only when its options or the reply change (refresh in place).
    const proposalReplies = new Map<Empire, ProposalResult>();
    let proposalVersion = 0;
    // [diplovoice] begin
    let closed = false;
    // 18b: the voiced line per reply (pending while the model answers; null = not voiced, the original stays).
    const voiced = new Map<ProposalResult, { pending: boolean; reply: VoicedReply | null; view: { showOriginal: boolean } }>();
    function startVoice(player: Empire, other: Empire, res: ProposalResult, label: string, optionId: string): void {
        if (!res.ok || res.reply === null || res.reply === 'DEAL_BEGIN') return;
        const raceName = other.dominantRace?.name ?? '';
        void diplomatVoiceConfig().then(async (cfg) => {
            if (cfg === null || closed) return;
            const set = await loadDialogSet(raceName);
            const original = set !== null ? proposalReplyText(set, res, raceName) : (res.reply ?? '');
            const state = { pending: true, reply: null as VoicedReply | null, view: { showOriginal: false } };
            voiced.set(res, state);
            proposalVersion++;
            render();
            const current = (): boolean => !closed && proposalReplies.get(other) === res;
            const v = await voiceDiplomatReply({
                galaxy: player.galaxy,
                ai: other,
                player,
                context: { kind: 'proposal', optionId, label, accepted: res.accepted, reply: res.reply, original },
                cfg,
                applyCounter: current,
            });
            state.pending = false;
            state.reply = v;
            if (closed) return;
            proposalVersion++;
            render();
        });
    }
    // [diplovoice] end
    let proposalBuilt: { other: Empire; key: string; node: HTMLElement } | null = null;

    function proposalsBlock(player: Empire, other: Empire): HTMLElement {
        const options = listProposals(player.galaxy, player, other);
        const reply = proposalReplies.get(other) ?? null;
        const key = `${proposalVersion};${player.controlDiplomacyTreaties};` + options.map((o) => `${o.id}|${o.label}|${o.enabled}`).join(';');
        if (proposalBuilt !== null && proposalBuilt.other === other && proposalBuilt.key === key) return proposalBuilt.node;

        const box = el('div', 'diplomacy-propose');
        const heading = el('div', 'diplomacy-section-heading', 'Propose…');
        // [diplovoice] begin
        heading.appendChild(voiceSwitch(() => render()));
        // [diplovoice] end
        box.appendChild(heading);
        const submit = (o: ProposalOption | string): void => {
            // Command log: queued, applied at the next frame boundary; the conversation updates then.
            issuePlayerCommand(player.galaxy, player, 'submitProposal', [other, typeof o === 'string' ? o : o.id], (res) => submitted(o, res));
        };
        const submitted = (o: ProposalOption | string, res: ProposalResult): void => {
            proposalReplies.set(other, res);
            proposalVersion++;
            if (res.expireMessagesFor !== null) expireDiplomacyMessages?.(res.expireMessagesFor);
            // [diplovoice] begin
            startVoice(player, other, res, typeof o === 'string' ? o : resolveGameText(o.label), typeof o === 'string' ? o : o.id);
            // [diplovoice] end
            // [tradenego] begin
            // DEAL_BEGIN (Main.Part10.cs:4324 method_302): the trade trees open beside the conversation.
            if (res.trade !== null) {
                openTradePanel({
                    galaxy: player.galaxy,
                    negotiation: res.trade,
                    resolveReply: (part: DialogPartType, e: Empire) => {
                        const raceName = e.dominantRace?.name ?? '';
                        return loadDialogSet(raceName).then((set) => (set !== null ? formatNet(set.resolveDialog(part, raceName), []) : part));
                    },
                    expireMessagesFor: (e) => expireDiplomacyMessages?.(e),
                    // [diplovoice] begin
                    voice: async (ctx, isCurrent, onStart) => {
                        const cfg = await diplomatVoiceConfig();
                        if (cfg === null || !isCurrent()) return null;
                        onStart();
                        return voiceDiplomatReply({
                            galaxy: player.galaxy,
                            ai: other,
                            player,
                            context: { kind: 'trade', theyGive: ctx.theyGive, weGive: ctx.weGive, accepted: ctx.accepted, reply: ctx.reply, original: ctx.original },
                            cfg,
                            applyCounter: isCurrent,
                        });
                    },
                    // [diplovoice] end
                    onChange: () => {
                        proposalVersion++;
                        render();
                    },
                });
            }
            // [tradenego] end
            render();
        };
        const optionButton = (o: ProposalOption): HTMLButtonElement => {
            const b = el('button', 'diplomacy-propose-option', resolveGameText(o.label)) as HTMLButtonElement;
            b.type = 'button';
            b.disabled = !o.enabled;
            if (o.hint) b.title = o.hint;
            b.addEventListener('click', () => submit(o));
            return b;
        };

        if (reply !== null) {
            const cls = !reply.ok ? 'diplomacy-reply-error' : reply.accepted ? 'diplomacy-reply-accepted' : 'diplomacy-reply-refused';
            const line = el('div', `diplomacy-reply ${cls}`);
            line.appendChild(el('span', 'diplomacy-reply-speaker', `${other.name}:`));
            const raceName = other.dominantRace?.name ?? '';
            const text = el('span', 'diplomacy-reply-text', proposalReplyText(null, reply, raceName));
            line.appendChild(text);
            box.appendChild(line);
            // [diplovoice] begin
            const voice = voiced.get(reply);
            const isVoiced = voice !== undefined && !voice.pending && voice.reply !== null && voice.reply.voiced;
            if (isVoiced) {
                line.appendChild(voicedLineToggle(text, voice.reply!.text, voice.reply!.original, voice.view));
                const note = counterNote(voice.reply!.counter);
                if (note !== null) box.appendChild(note);
            } else if (voice?.pending === true) {
                line.appendChild(voicingIndicator());
            }
            // [diplovoice] end
            if (!isVoiced && reply.ok && reply.reply !== null) {
                void loadDialogSet(raceName).then((set) => {
                    text.textContent = set !== null ? proposalReplyText(set, reply, raceName) : reply.reply;
                });
            }
            if (reply.followUps.length > 0) {
                const row = el('div', 'diplomacy-propose-options diplomacy-propose-followups');
                for (const f of reply.followUps) row.appendChild(optionButton(f));
                box.appendChild(row);
            }
            // Main.Part10.cs:4150 GenerateAutomationMessageBox("Treaty Negotiation"): offered after the action here.
            if (reply.automationPrompt && player.controlDiplomacyTreaties === AutomationLevel.FullyAutomated) {
                const auto = el('div', 'diplomacy-propose-automation');
                auto.appendChild(el('span', '', `${resolveGameText('Treaty Negotiation')} is automated`));
                const off = el('button', 'diplomacy-propose-option', 'Turn off') as HTMLButtonElement;
                off.type = 'button';
                off.addEventListener('click', () => {
                    issuePlayerCommand(player.galaxy, player, 'setEmpireControl', ['controlDiplomacyTreaties', MANUAL], () => render());
                });
                auto.appendChild(off);
                box.appendChild(auto);
            }
        }

        if (options.length === 0) box.appendChild(el('div', 'diplomacy-line diplomacy-muted', '(nothing to propose)'));
        for (const g of proposalGroups(options)) {
            const group = el('div', 'diplomacy-propose-group');
            group.appendChild(el('div', 'diplomacy-propose-label', resolveGameText(g.label)));
            const row = el('div', 'diplomacy-propose-options');
            for (const o of g.options) row.appendChild(optionButton(o));
            group.appendChild(row);
            box.appendChild(group);
        }
        proposalBuilt = { other, key, node: box };
        return box;
    }
    // [proposals] end

    render();
    const timer = setInterval(render, 1000);

    function close(): void {
        // [diplovoice] begin
        closed = true;
        // [diplovoice] end
        clearInterval(timer);
        // [tradenego] begin
        closeTradePanel();
        // [tradenego] end
        document.removeEventListener('keydown', onKeyDown);
        root.remove();
        open = null;
    }

    // Escape closes the panel; stopImmediatePropagation keeps the global
    // game-menu Escape handler (registered in createHud) from opening as well.
    function onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            close();
        }
    }
    document.addEventListener('keydown', onKeyDown);
    closeBtn.addEventListener('click', () => close());

    function select(empire: Empire): void {
        selected = empire;
        detailScroll = 0;
        render();
    }

    return { root, close, select };
}
