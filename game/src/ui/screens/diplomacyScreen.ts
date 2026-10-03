// Diplomacy screen (F5 / the top bar's diplomacy button): a port of the original pnlEmpireInfo ScreenPanel on the shared
// original-style window (../originalWindow.ts).
// Sources:
// - DistantWorlds/Main.Part11.cs:4816 method_195 (window 1040 × 760 / 1180 × 900, the list at (10, 10), the detail at
//   (430, 10), the right column: Speak, "Known Systems for this Empire" map, colour key, help links), method_196;
// - DistantWorlds.Controls/Controls/DiplomaticRelationListView.cs (the empire list + the relation strip: line colours,
//   feeling, trade value, alliance, agent / refuel / mining icons), EmpireListView.cs (flag, race, name with the
//   strategic-value bar), DiplomaticRelationColorKey.cs;
// - EmpireDetailView.cs DrawEmpireDetail (flag, races, name, stats, Dominant Race, Current Relationship With Us,
//   Treaty on Offer + Accept Offer, feeling and factors; the pirate branch), Kickstart (large fonts), BindData;
// - Main.Part8.cs:449 method_296 (the talk panel pnlDiplomacyTalk: flag + name, race picture, response, options);
// - Main.Part2.cs:4619-4690 (pnlRelationAllianceName: a list row double-clicked names the alliance, method_683);
// - TradeRestrictedResourcesPanel.cs (the restricted-resource lines and our trade checkbox, a player command);
// - DistantWorlds.Types/Empire.4.cs:55 ResolveFeelingDescription; Empire.7.cs:4164 DetermineEmpireRelationshipFactors;
//   Empire.10.cs:681 CivilityDescription; Main.Part10.cs:3930 method_235 (decline).
// Proposals (task 17e): the player's conversation options (Main.Part9.cs:46 method_238 / Main.Part10.cs:3957 method_237,
// sim/player/diplomacyProposals.ts) in the talk panel's HyperlinkOptionsBox, the reply in its response panel.
// Pirate factions: DiplomaticRelationListView.cs:164-176 lists every met pirate faction too; their talk panel offers the
// protection request / cancel (per month and per year).
// Our additions (kept from the streamlined screen): the All / Empires / Pirates, government and name filters over the
// list, Decline, Go-to, the Empires list button, the war goals / charter / Concord / council / reputation / incident
// blocks under the factors, the independent leagues.

import './diplomacyScreen.css';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { EmpireMessage } from '../../sim/messages';
import { getGovernmentsStatic, AutomationLevel } from '../../sim/empire';
import { displayColorForEmpire } from '../../sim/empireColors';
import { PirateRelationType } from '../../sim/pirateRelations';
import { calculatePirateProtectionPricePerMonth } from '../../sim/pirates/pirateRelationsAI';
import { pirateProtectionPriceText, pirateProtectionYearlySuffix } from '../pirateProtectionPrice';
import {
    DiplomaticRelation,
    DiplomaticRelationType,
    DiplomaticStrategy,
    empireEvaluationByEmpire,
    empireEvaluationsOf,
} from '../../sim/diplomacy';
import { determineDesiredDiplomaticRelationTypical, MANUAL } from '../../sim/diplomacyTick';
import { galaxyStarDate } from '../../sim/tick/simTime';
import { applyEmpireEmblem, racePortraitUrl } from '../empireEmblem';
import type { Habitat } from '../../sim/types';
import { BuiltObjectRole } from '../../sim/data/designSpecifications';
import { totalColonyStrategicValue } from '../../sim/forceStructure';
import { determineResourcesEmpireSupplies } from '../../sim/diplomacyTick';
import { SystemVisibilityStatus } from '../../sim/visibility';
import { empireFlagUrl } from '../selectionInfoView';
import { dropShadowColor } from '../selectionInfo';
import { uiScaleFactor } from '../settings';
import { openGalactopedia } from './galactopedia';
import { drawSystemsMiniMap } from './galaxyMap';
import {
    COLORS,
    FONT,
    OwGrid,
    amountBarWidth,
    checkBox,
    chromeImageUrl,
    darkRect,
    dropDown,
    dropText,
    el,
    glassButton,
    gradientPanel,
    isLargeScreen,
    linkLabel,
    openOriginalWindow,
    originalVirtualSize,
    place,
    rgbCss,
    scrollPanel,
    setButtonLabel,
    text,
    textBox,
    valueRow,
    type OriginalWindow,
} from '../originalWindow';
import {
    RELATION_STRIP_BACK,
    ambassadorAt,
    diplomacyBackgroundColor,
    diplomacyLayout,
    empireRaces,
    piratePlayStyleName,
    piratePortraitUrl,
    raceCharacteristics,
    relationLine,
    type DiplomacyLayout,
    type RelationLine,
} from './diplomacyRelationsView';
import { leagueSection } from '../leagueRows';
import { rimTraderTermsRows, type RimTraderTermsRows } from '../scenario/rimTraderRows';
import { rimTraderEmpire } from '../../sim/scenario/rimTrade/common';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../../sim/galaxyTime';
import { EmpireMessageType, empireMessages } from '../../sim/messages';
import { showToast } from '../toast';
import { empireIntel, formatMillions } from './empireIntel';
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
import type { Character } from '../../sim/characters';
import { CHARACTER_IMAGE_SPEC, characterPortrait } from '../characterPortrait';
import { abilityBonusLines } from './empireSummaryModel';
import { determineEmpireRelationshipFactors } from '../../sim/empireRelationshipFactors';
import { EmpireActivityType } from '../../sim/pirates/empireActivity';
import { gameText as gameTextKey } from '../../sim/colonyTick';
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
    /** A pirate faction (PirateEmpireBaseHabitat != null), listed through the player's PirateRelation. */
    isPirate: boolean;
    /** GovernmentAttributes.Name of the empire's government ('' when it has none, as pirate factions have). */
    governmentName: string;
    /** Pirate rows: the pirate relation with the player (NotMet for an empire row). */
    pirateRelationType: PirateRelationType;
    /** Pirate rows: the monthly protection fee in force (0 without an agreement / for a free truce). */
    protectionFeePerMonth: number;
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

/** Pen colours of DiplomaticRelationListView.DrawRelations for a pirate relation (:200-260): None grey, Protection light blue. */
export const PIRATE_RELATION_COLORS: Record<PirateRelationType, number> = {
    [PirateRelationType.NotMet]: 0xd2b48c,
    [PirateRelationType.None]: 0x808080,
    [PirateRelationType.Protection]: 0xa0a0ff,
};

/** The label of a pirate relation, with the protection fee per month and per year when an agreement is in force. */
export function pirateRelationText(type: PirateRelationType, feePerMonth: number): string {
    switch (type) {
        case PirateRelationType.Protection:
            return feePerMonth > 0 ? `Pirate protection: ${pirateProtectionPriceText(feePerMonth)}` : 'Pirate truce (free protection)';
        case PirateRelationType.None:
            return 'No pirate agreement';
        default:
            return 'Not Met';
    }
}

/** The monthly fee the player pays a pirate faction under the agreement (PirateRelation.MonthlyProtectionFeeToThisEmpire,
 *  stored on the pirate's side of the pair by ChangePirateRelation). */
function protectionFeeOf(player: Empire, other: Empire): number {
    const pirateSide = other.pirateEmpireBaseHabitat !== null ? other : player;
    const otherSide = pirateSide === other ? player : other;
    return pirateSide.pirateRelations?.getRelationByOtherEmpire(otherSide)?.monthlyProtectionFeeToThisEmpire ?? 0;
}

/** Rows for the panel: every met, active, non-independent empire (diplomatic relation not NotMet) and every met pirate faction
 *  (pirate relation not NotMet; DiplomaticRelationListView.cs:164-176), sorted by name. */
export function diplomacyRows(player: Empire, starDate: number, playerGovernmentName: string): DiplomacyRow[] {
    const rels: Array<{ other: Empire; rel: DiplomaticRelation | null; pirateType: PirateRelationType }> = [];
    const seen = new Set<Empire>();
    for (const rel of player.diplomaticRelations) {
        if (rel.type === DiplomaticRelationType.NotMet) continue;
        const other = rel.otherEmpire;
        if (other === null || !other.active) continue;
        if (other === player.galaxy.independentEmpire) continue;
        if (other.pirateEmpireBaseHabitat !== null) continue;
        rels.push({ other, rel, pirateType: PirateRelationType.NotMet });
        seen.add(other);
    }
    for (const pr of player.pirateRelations ?? []) {
        const other = pr.otherEmpire;
        if (pr.type === PirateRelationType.NotMet || other === null || !other.active) continue;
        if (other === player.galaxy.independentEmpire || other === player || seen.has(other)) continue;
        if (other.pirateEmpireBaseHabitat === null) continue;
        rels.push({ other, rel: null, pirateType: pr.type });
        seen.add(other);
    }
    rels.sort((a, b) => a.other.name.localeCompare(b.other.name));

    return rels.map(({ other, rel: relOrNull, pirateType }) => {
        const governmentName = other.governmentId >= 0 ? (getGovernmentsStatic()[other.governmentId]?.name ?? '') : '';
        if (relOrNull === null) {
            const fee = protectionFeeOf(player, other);
            return {
                empire: other,
                isPirate: true,
                governmentName,
                pirateRelationType: pirateType,
                protectionFeePerMonth: fee,
                name: other.name,
                color: displayColorForEmpire(other),
                relationType: DiplomaticRelationType.None,
                relationText: pirateRelationText(pirateType, fee),
                relationColor: PIRATE_RELATION_COLORS[pirateType],
                attitude: null,
                feeling: '',
                ourStrategy: '',
                treaties: [],
                incoming: null,
                incomingText: '',
                incomingMessage: '',
                outgoing: null,
                outgoingText: '',
                factors: [],
            };
        }
        const rel = relOrNull;
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
            isPirate: false,
            governmentName,
            pirateRelationType: PirateRelationType.NotMet,
            protectionFeePerMonth: 0,
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

/** The list's kind filter: everything, only the empires, or only the pirate factions. */
export type DiplomacyKindFilter = 'all' | 'empires' | 'pirates';

/** The government a row is filed under: its GovernmentAttributes.Name; pirate factions have none. */
export function governmentLabel(row: Pick<DiplomacyRow, 'isPirate' | 'governmentName'>): string {
    if (row.governmentName !== '') return row.governmentName;
    return row.isPirate ? 'Pirate faction' : 'Unknown';
}

/** The governments present among `rows` (for the filter's drop-down), sorted by name. */
export function governmentFilterOptions(rows: readonly DiplomacyRow[]): string[] {
    return [...new Set(rows.map(governmentLabel))].sort((a, b) => a.localeCompare(b));
}

/** The kind and government filters of the list ('' = every government); the name query is filterDiplomacyRows. */
export function filterDiplomacyRowsByKind(rows: DiplomacyRow[], kind: DiplomacyKindFilter, government: string): DiplomacyRow[] {
    return rows.filter((r) => {
        if (kind === 'empires' && r.isPirate) return false;
        if (kind === 'pirates' && !r.isPirate) return false;
        return government === '' || governmentLabel(r) === government;
    });
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

/** Main.Part10.cs:3590 method_230 for any part: string.Format(dialogSet.ResolveDialog(type, race), args) ('…' while the
 *  dialog files load; the part name when they cannot be read). */
export function dialogReplyText(raceName: string, part: DialogPartType, args: readonly string[]): Promise<string> {
    return loadDialogSet(raceName).then((set) => (set !== null ? formatNet(set.resolveDialog(part, raceName), [...args]) : part));
}

let expireDiplomacyMessages: ((empire: Empire) => void) | null = null;

/** messagePopups (16d) registers its conversation queue's ExpireDiplomacyMessagesForEmpire here. */
export function setDiplomacyMessageExpiry(fn: ((empire: Empire) => void) | null): void {
    expireDiplomacyMessages = fn;
}

// DialogSet.cs:21 Initialize: base_dialog.txt plus the race's file, loaded on first use.
let dialogLoad: Promise<DialogSet | null> | null = null;
const raceDialogLoads = new Map<string, Promise<void>>();
export function loadDialogSet(raceName: string): Promise<DialogSet | null> {
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
// ---------------------------------------------------------------------------
// DOM: the original Diplomacy screen (pnlEmpireInfo) on the shared original-style window (../originalWindow.ts)
// ---------------------------------------------------------------------------

export interface DiplomacyScreenOptions {
    player: Empire;
    /** Select this empire's row on open; if the screen is already open, re-select it instead of closing (16d "Open
     *  diplomacy" button on a pirate offer popup / Main.Part8.cs:449 method_296, which always brought that empire's
     *  talk panel to the front rather than toggling it closed). */
    selectedEmpire?: Empire;
    /** Adds an "Empire list" button in the right column that opens the Empires list window (capital zoom /
     *  charters). Omitted = no such button. */
    onOpenEmpiresList?: () => void;
    /** Go-to: centre the main view on a habitat (the selected empire's capital / known pirate base). */
    onGoTo?: (habitat: Habitat) => void;
}

interface OpenState {
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

/** Whether the Diplomacy screen is open. */
export function isDiplomacyScreenOpen(): boolean {
    return open !== null;
}

function rgb(c: number): string {
    return rgbCss(c);
}

const LIGHT_GREEN = COLORS.green;
const RED = COLORS.red;
const TEXT = COLORS.text;
const HEADER_TEXT = 'rgb(200, 200, 200)';

// Empire flags as URLs, resolved once (empireFlagUrl composes the stock flag / scenario emblem asynchronously).
const flagUrls = new Map<Empire, string>();
export function flagImage(empire: Empire, w: number, h: number, className = 'dip-flag'): HTMLImageElement {
    const img = el('img', className);
    img.alt = '';
    img.draggable = false;
    img.width = w;
    img.height = h;
    const known = flagUrls.get(empire);
    if (known !== undefined) img.src = known;
    else if (empire.galaxy != null) {
        void empireFlagUrl(empire.galaxy, empire).then((url) => {
            flagUrls.set(empire, url);
            img.src = url;
        });
    }
    return img;
}

/** RaceImageCache.GetEmpireDominantRaceImage: the race portrait, or the pirate playstyle image for a pirate faction
 *  (scenario portrait overrides through the 19r emblem hook). */
export function raceImage(empire: Empire, size: number, className = 'dip-race'): HTMLImageElement {
    const img = el('img', className);
    img.alt = '';
    img.draggable = false;
    img.width = size;
    img.height = size;
    if (empire.pirateEmpireBaseHabitat !== null) img.src = piratePortraitUrl(empire.piratePlayStyle);
    else applyEmpireEmblem(img, empire.galaxy, empire, 'portrait');
    img.addEventListener('error', () => (img.style.visibility = 'hidden'));
    return img;
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
            const img = el('img');
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

/** A list entry: the player first (DiplomaticRelationListView.BindData adds `_Empire` first), then the met empires and
 *  pirate factions (diplomacyRows). */
interface ListEntry {
    empire: Empire;
    row: DiplomacyRow | null;
}

/** DiplomaticRelationListView: EmpireListView (flag 46, race 30, name with the strategic-value bar) and the relation
 *  strip (RelationViewWidth 180) beside it; 30 px rows on (60, 60, 72). */
function buildRelationList(
    lay: DiplomacyLayout,
    listH: number,
    onSelect: (e: Empire) => void,
    onTalk: (e: Empire) => void,
): { grid: OwGrid<ListEntry>; setData: (entries: ListEntry[], viewpoint: Empire, player: Empire) => void } {
    let viewpoint: Empire | null = null;
    let player: Empire | null = null;
    let maxValue = 0;
    const strip = lay.list.relationWidth;
    const grid = new OwGrid<ListEntry>({
        key: (e) => e.empire,
        rowHeight: 30,
        headers: false,
        rowBack: rgb(RELATION_STRIP_BACK),
        rowAltBack: rgb(RELATION_STRIP_BACK),
        columns: [
            {
                id: 'flag',
                header: '',
                width: 46,
                align: 'center',
                render: (e, cell) => {
                    // LargeFlagPicture scaled to 24 px high (100 × 60 → 40 × 24).
                    cell.appendChild(flagImage(e.empire, 40, 24));
                },
            },
            {
                id: 'race',
                header: '',
                width: 30,
                align: 'center',
                sort: (e) => e.empire.dominantRace?.name ?? '',
                render: (e, cell) => {
                    cell.appendChild(raceImage(e.empire, 24));
                    cell.title = e.empire.pirateEmpireBaseHabitat !== null ? piratePlayStyleName(e.empire.piratePlayStyle) : e.empire.dominantRace?.name ?? '';
                },
            },
            {
                id: 'name',
                header: 'Name',
                fill: 1,
                sort: (e) => e.empire.name,
                render: (e, cell) => {
                    // DataGridViewTextBoxDropShadowCell: the TotalColonyStrategicValue bar under a 17 px bold name in
                    // the empire's main colour (yellow when selected) with the contrast drop shadow.
                    cell.classList.add('dip-name-cell');
                    const color = displayColorForEmpire(e.empire);
                    cell.style.setProperty('--dip-name', rgb(color));
                    cell.style.setProperty('--dip-name-shadow', dropShadowColor(color) === 0 ? '#000' : '#fff');
                    const value = totalColonyStrategicValue(e.empire);
                    if (value > 0 && maxValue > 0) {
                        const bar = el('div', 'dip-name-bar');
                        bar.style.width = `${amountBarWidth(value, maxValue, lay.list.w - strip - 76 - 14)}px`;
                        cell.appendChild(bar);
                    }
                    const name = el('span', 'dip-name', e.empire.name);
                    cell.appendChild(name);
                    cell.title = e.row !== null ? `${e.empire.name} — ${e.row.relationText}` : e.empire.name;
                },
            },
            {
                id: 'relation',
                header: '',
                width: strip,
                render: (e, cell) => {
                    cell.classList.add('dip-strip');
                    if (viewpoint !== null && player !== null && e.empire !== viewpoint) drawRelation(cell, relationLine(viewpoint, e.empire, player), viewpoint, e.empire, strip);
                },
            },
        ],
        onSelect: (e) => onSelect(e.empire),
        onDoubleClick: (e) => onTalk(e.empire),
    });
    grid.el.classList.add('dip-list');
    grid.el.style.height = `${listH}px`;
    return {
        grid,
        setData(entries, vp, pl) {
            viewpoint = vp;
            player = pl;
            maxValue = 0;
            for (const e of entries) maxValue = Math.max(maxValue, totalColonyStrategicValue(e.empire));
            grid.setRows(entries);
        },
    };
}

/** DrawRelations for one row (row-relative: the line centre at 4 + 30 / 2 = 19, text at 19 - 13). */
function drawRelation(cell: HTMLElement, line: RelationLine, viewpoint: Empire, row: Empire, width: number): void {
    const y = 19;
    if (line.color !== null) {
        const c = rgb(line.color);
        if (line.shape === 'line') {
            const l = place(el('div', 'dip-rel-line'), 0, y - 1, width, 3);
            // The 10 px LinearGradientBrush from pen3 (60, 60, 72) to the pen colour at the left end.
            l.style.background = `linear-gradient(to right, ${rgb(RELATION_STRIP_BACK)}, ${c} 10px)`;
            cell.appendChild(l);
        } else if (line.shape !== 'none') {
            const w = place(el('div', 'dip-rel-wedge'), 0, y - 1, width, 8);
            w.style.background = c;
            w.style.clipPath = line.shape === 'wedge-out' ? 'polygon(0 0, 0 2px, 100% 100%, 100% 0)' : 'polygon(0 0, 0 100%, 100% 2px, 100% 0)';
            cell.appendChild(w);
        }
        if (line.feeling !== '') {
            const f = place(text(line.feeling, { size: FONT.normal, color: c, shadow: false }), 2, y - 13);
            cell.appendChild(f);
        }
        if (line.trade !== '') {
            const t = text(line.trade, { size: FONT.normal, color: c, shadow: false, className: 'dip-rel-trade' });
            // x = (RelationViewWidth - textWidth) / 2 - 10: centred 10 px left of the middle.
            place(t, width / 2 - 10, y - 13);
            cell.appendChild(t);
        }
    }
    if (line.alliance !== '') {
        const a = text(line.alliance, { size: FONT.small, bold: true, color: 'rgb(170, 170, 170)', className: 'dip-rel-alliance' });
        place(a, 0, y - 1, width);
        cell.appendChild(a);
    }
    if (line.agent) {
        const img = place(el('img', 'dip-rel-icon'), width - 72, y - 13 - 4);
        img.src = chromeImageUrl('characters.png');
        img.alt = '';
        img.title = 'Our agent is in deep cover in this empire';
        cell.appendChild(img);
    }
    const pair = (on1: boolean, on2: boolean, x: number, icon: string, iconX: number, tip: string): void => {
        if (!on1 && !on2) return;
        const y1 = y - 13;
        if (on1) cell.appendChild(place(flagImage(viewpoint, 13, 8, 'dip-rel-flag'), x - 2, y1 - 3));
        if (on2) cell.appendChild(place(flagImage(row, 13, 8, 'dip-rel-flag'), x - 2, y1 + 7));
        const img = place(el('img', 'dip-rel-icon'), iconX, y1 - 1, 16, 16);
        img.src = chromeImageUrl(icon);
        img.alt = '';
        img.title = tip;
        cell.appendChild(img);
    };
    pair(line.refuelToViewpoint, line.refuelFromViewpoint, width - 50, 'refuel.png', width - 50 + 6, 'Military refueling');
    pair(line.miningToViewpoint, line.miningFromViewpoint, width - 23, 'mine.png', width - 23 + 7, 'Mining rights');
}

/** DiplomaticRelationColorKey.DrawColorKey: the title and one line per relation (label right-aligned in 125 px, a
 *  30 × 3 swatch at x 135), Pirate Protection after a blank row. */
function buildColorKey(): HTMLElement {
    const p = gradientPanel({ corners: { tl: true, tr: true, br: true, bl: true }, radius: 20, className: 'dip-key' });
    dropText(p, 'Diplomatic Relations', 10, 10, { size: FONT.normal + 2, bold: true, color: '#fff' });
    const rows: [string, number][] = [
        ['Mutual Defense Pact', 0x4040e8],
        ['Protectorate', 0x7070ff],
        ['Free Trade Agreement', 0x00ff00],
        ['No Relationship', 0x808080],
        ['Subjugated Dominion', 0xffff00],
        ['Trade Sanctions', 0xffa500],
        ['War', 0xff0000],
    ];
    let y = 30;
    const line = (label: string, color: number): void => {
        const t = text(label, { size: FONT.normal, color: rgb(color), shadow: false, className: 'ow-right' });
        p.appendChild(place(t, 125, y - 2));
        const sw = place(el('div', 'dip-key-swatch'), 135, y + 6, 30, 3);
        sw.style.background = rgb(color);
        p.appendChild(sw);
    };
    for (const [label, color] of rows) {
        line(label, color);
        y += 14;
    }
    y += 14;
    line('Pirate Protection', 0xa0a0ff);
    return p;
}

/** gmapEmpireDetail: the galaxy (black, star dots) with the selected empire's known systems highlighted in yellow
 *  (method_196: its colonies' systems the player has seen, or the known bases of a pirate faction). */
function drawKnownSystems(canvas: HTMLCanvasElement, player: Empire, empire: Empire): void {
    const galaxy = player.galaxy;
    const systems = new Set<Habitat>();
    if (empire.pirateEmpireBaseHabitat !== null) {
        for (const b of player.knownPirateBases ?? []) {
            if (b != null && b.empire === empire && b.parentHabitat != null) {
                const star = galaxy.determineHabitatSystemStar(b.parentHabitat);
                if (star !== null) systems.add(star);
            }
        }
    } else {
        for (const c of empire.colonies) {
            const vis = player.visibility?.checkSystemVisibilityStatus?.(c.systemIndex);
            if (vis === SystemVisibilityStatus.Visible || vis === SystemVisibilityStatus.Explored) {
                const star = galaxy.determineHabitatSystemStar(c);
                if (star !== null) systems.add(star);
            }
        }
    }
    drawSystemsMiniMap(canvas, galaxy, 195, systems);
}

function createDiplomacyScreen(opts: DiplomacyScreenOptions): OpenState {
    const player = opts.player;
    let lay = diplomacyLayout(isLargeScreen(originalVirtualSize(window.innerWidth, window.innerHeight, uiScaleFactor())));
    let selected: Empire = opts.selectedEmpire ?? player;
    // Task 19k-1d (Big Galaxies: 60-empire games): a name filter, plus the kind (All / Empires / Pirates) and
    // government-type filters of the list.
    let filterQuery = '';
    let kindFilter: DiplomacyKindFilter = 'all';
    let governmentFilter = '';
    let extrasScroll = 0;
    let closed = false;
    // listProposals (method_238 obtains the relations it lists) and the protection price (ObtainPirateRelation) are UI
    // reads in both modes (on the replica in worker mode): the lookups do not write, and the records the C# adds here
    // become a journaled command (sim/readOnlyQuery.ts requestUiRecord; docs/sim-worker.md §8).

    const win = openOriginalWindow({
        id: 'diplomacy',
        title: 'Diplomacy',
        icon: 'diplomacy.png',
        width: lay.window.w,
        height: lay.window.h,
        onClose: () => {
            // [diplovoice] begin
            closed = true;
            // [diplovoice] end
            clearInterval(timer);
            talk?.close();
            allianceWin?.close();
            // [tradenego] begin
            closeTradePanel();
            // [tradenego] end
            open = null;
        },
        onResize: (w) => {
            const large = isLargeScreen(w.virtualSize);
            if (large !== lay.large) {
                lay = diplomacyLayout(large);
                w.setSize(lay.window.w, lay.window.h);
                build();
            }
        },
    });
    const body = win.body;

    // ---- static parts (rebuilt on a layout switch) ----
    let list!: ReturnType<typeof buildRelationList>;
    let filterRow!: HTMLElement;
    let detail!: HTMLDivElement;
    let speakBtn!: HTMLButtonElement;
    let mapCanvas!: HTMLCanvasElement;
    let mapFor: Empire | null = null;
    let mapAt = 0;
    let extraCol!: HTMLDivElement;

    function build(): void {
        body.replaceChildren();
        // Our filters on top of the list (the list is 30 px shorter than the original's to make room).
        filterRow = place(el('div', 'dip-filters'), lay.list.x, lay.list.y, lay.list.w, 24);
        body.appendChild(filterRow);
        const listY = lay.list.y + 30;
        const listH = lay.list.h - 30;
        // DiplomaticRelationListView _RelationDoubleClicked (a row or its relation strip) → Main.Part2.cs:4677
        // ctlEmpireDiplomaticRelationList__RelationDoubleClicked: the alliance naming panel (Speak is the button).
        list = buildRelationList(lay, listH, (e) => select(e, false), (e) => openAllianceName(e));
        place(list.grid.el, lay.list.x, listY, lay.list.w, listH);
        body.appendChild(list.grid.el);

        // pnlEmpireDetailInfo: curve BottomRight_TopRight 20, border width 3, (96, 96, 96).
        detail = gradientPanel({ corners: { tr: true, br: true }, radius: 20, border: 'rgb(96, 96, 96)', borderWidth: 3, className: 'dip-detail' });
        place(detail, lay.detail.x, lay.detail.y, lay.detail.w, lay.detail.h);
        body.appendChild(detail);

        // The right column (x num3).
        const cx = lay.column.x;
        speakBtn = glassButton('Speak', { onClick: () => openTalk(selected), size: FONT.normal });
        place(speakBtn, cx, 30, 195, 50);
        body.appendChild(speakBtn);
        dropText(body, 'Known Systems for this Empire', cx, 97, { size: FONT.normal, color: COLORS.label, shadow: false });
        const mapBox = place(el('div', 'dip-map'), cx, 115, 195, 195);
        mapCanvas = el('canvas');
        mapBox.appendChild(mapCanvas);
        body.appendChild(mapBox);
        mapFor = null;
        body.appendChild(place(buildColorKey(), cx, 320, 195, 168));
        // NuSppwjfQh / lnkDiplomacyReputation / lnkDiplomacyPirates → method_456(topic).
        body.appendChild(place(linkLabel('Learn about Diplomatic Relations...', () => openGalactopedia({ topic: 'Diplomatic Relation Types' })), cx, 530));
        body.appendChild(place(linkLabel('Learn about Empire Reputation...', () => openGalactopedia({ topic: 'Empire Reputation' })), cx, 555));
        body.appendChild(place(linkLabel('Learn about Pirates...', () => openGalactopedia({ topic: 'Pirates' })), cx, 580));
        // Our additions under the links: go-to, the Empires list, the independent leagues.
        extraCol = place(el('div', 'dip-extra-col'), cx, 610, 195, lay.detail.y + lay.detail.h - 610);
        body.appendChild(extraCol);
        render();
    }

    function select(empire: Empire, scroll: boolean): void {
        if (selected !== empire) extrasScroll = 0;
        selected = empire;
        if (scroll) list.grid.select(empire, true);
        render();
        if (talk !== null && !talk.closed && talkFor !== empire && empire !== player) openTalk(empire);
    }

    function render(): void {
        if (closed) return;
        const starDate = galaxyStarDate(player.galaxy);
        const rows = diplomacyRows(player, starDate, playerGovernmentName(player));
        if (selected !== player && !rows.some((r) => r.empire === selected)) selected = player;

        // Filters (kept focus / caret on rebuild).
        const prevText = filterRow.querySelector<HTMLInputElement>('input');
        const hadFocus = prevText !== null && document.activeElement === prevText;
        const caret = prevText?.selectionStart ?? null;
        filterRow.replaceChildren();
        const kind = dropDown(
            [
                { value: 'all', label: 'All' },
                { value: 'empires', label: 'Empires' },
                { value: 'pirates', label: 'Pirates' },
            ],
            kindFilter,
            (v) => {
                kindFilter = v as DiplomacyKindFilter;
                render();
            },
            'Show all AI players, only the empires, or only the pirate factions',
        );
        kind.classList.add('diplomacy-filter-kind');
        place(kind, 0, 0, 96, 24);
        const govOptions = governmentFilterOptions(rows);
        if (governmentFilter !== '' && !govOptions.includes(governmentFilter)) governmentFilter = '';
        const gov = dropDown(
            [{ value: '', label: 'Any government' }, ...govOptions.map((g) => ({ value: g, label: g }))],
            governmentFilter,
            (v) => {
                governmentFilter = v;
                render();
            },
            'Show only AI players with this type of government',
        );
        gov.classList.add('diplomacy-filter-government');
        place(gov, 100, 0, 150, 24);
        const filter = textBox(filterQuery, 'Filter empires…', (v) => {
            filterQuery = v;
            render();
        });
        filter.classList.add('diplomacy-filter');
        place(filter, 254, 0, lay.list.w - 254, 24);
        filterRow.append(kind, gov, filter);
        if (hadFocus) {
            filter.focus();
            if (caret !== null) filter.setSelectionRange(caret, caret);
        }

        const shown = filterDiplomacyRows(filterDiplomacyRowsByKind(rows, kindFilter, governmentFilter), filterQuery);
        const entries: ListEntry[] = [{ empire: player, row: null }, ...shown.map((r) => ({ empire: r.empire, row: r }))];
        list.setData(entries, selected, player);
        list.grid.select(selected, false);

        renderDetail(rows.find((r) => r.empire === selected) ?? null);

        // btnEmpireTalk (method_196).
        if (selected === player) {
            setButtonLabel(speakBtn, '(Your Empire)');
            speakBtn.disabled = true;
        } else {
            setButtonLabel(speakBtn, `Speak with ${selected.name}`);
            speakBtn.disabled = false;
        }

        const now = Date.now();
        if (mapFor !== selected || now - mapAt > 5000) {
            mapFor = selected;
            mapAt = now;
            drawKnownSystems(mapCanvas, player, selected);
        }

        renderExtraColumn();
    }

    function renderExtraColumn(): void {
        extraCol.replaceChildren();
        let y = 0;
        const target = selected.pirateEmpireBaseHabitat !== null ? knownPirateBaseOf(player, selected) : selected.capital;
        if (opts.onGoTo) {
            const goTo = glassButton(selected.pirateEmpireBaseHabitat !== null ? 'Go to pirate base' : 'Go to capital', {
                onClick: () => {
                    if (target != null) opts.onGoTo!(target);
                },
                disabled: target == null || (selected !== player && selected.pirateEmpireBaseHabitat === null && empireIntel(player, selected).capital === null),
                title: 'Centre the view on it',
            });
            extraCol.appendChild(place(goTo, 0, y, 195, 30));
            y += 34;
        }
        if (opts.onOpenEmpiresList) {
            const listBtn = glassButton('Empire list', { onClick: () => opts.onOpenEmpiresList!(), title: 'Open the list of empires with capital zoom' });
            extraCol.appendChild(place(listBtn, 0, y, 195, 30));
            y += 34;
        }
        // 19r: the independent leagues (19k-3) with their flags.
        const leagues = leagueSection(player.galaxy, 'diplomacy');
        if (leagues !== null) {
            const sc = place(scrollPanel('dip-leagues'), 0, y, 195, Math.max(40, extraCol.clientHeight - y));
            sc.appendChild(leagues);
            extraCol.appendChild(sc);
        }
    }

    // ---- detail (EmpireDetailView.DrawEmpireDetail) ----
    function renderDetail(row: DiplomacyRow | null): void {
        const keep = detail.querySelector<HTMLElement>('.dip-extras');
        if (keep) extrasScroll = keep.scrollTop;
        detail.replaceChildren();
        const empire = selected;
        const f = lay.fonts;
        // BindData: BackColor2 = SetColorForDiplomacyBackground(empire).
        detail.style.background = `linear-gradient(to bottom, rgb(39, 40, 44) 0%, ${rgb(diplomacyBackgroundColor(empire.mainColor))} 50%, rgb(51, 54, 61) 100%)`;

        // LargeFlagPicture at (20, 20), the dominant race picture (140, 20, 60, 60), the other races 27 × 27 from
        // (220, 20), five a row, "..." after eight.
        detail.appendChild(place(flagImage(empire, 100, 60, 'dip-detail-flag'), 20, 20));
        detail.appendChild(place(raceImage(empire, 60, 'dip-detail-race'), 140, 20));
        const races = empire.pirateEmpireBaseHabitat !== null ? [] : empireRaces(empire);
        for (let i = 1; i < races.length; i++) {
            if (i >= 9) {
                dropText(detail, '...', 340, 48, { size: f.normal, color: TEXT, shadow: false });
                break;
            }
            const n = i <= 4 ? i - 1 : i - 5;
            const yy = i <= 4 ? 20 : 53;
            const img = place(el('img', 'dip-other-race'), 220 + n * 30, yy, 27, 27);
            img.src = racePortraitUrl(races[i].race.pictureIndex);
            img.alt = '';
            img.title = `${races[i].race.name} (${formatMillions(races[i].millions)})`;
            detail.appendChild(img);
        }
        // The name (title font, white, drop shadow) at (20, 85) and the alliance name centred in the rest of 340 px.
        const title = dropText(detail, empire.name, 20, 85, { size: f.title, bold: true, color: '#fff' });
        const alliance = empire.diplomaticRelations.getHighestAllianceName();
        if (alliance !== '') {
            const a = text(alliance, { size: f.normal, bold: true, color: '#fff', className: 'dip-alliance' });
            a.style.left = '20px';
            a.style.top = '85px';
            a.style.width = '340px';
            a.style.textAlign = 'right';
            detail.appendChild(a);
            void title;
        }

        if (empire.pirateEmpireBaseHabitat !== null) renderPirateDetail(empire, row);
        else renderEmpireDetail(empire, row);
    }

    /** Non-pirate branch: the stat block, Dominant Race, Current Relationship With Us + Treaty on Offer + feeling and
     *  factors, then our additions in a scrolling region below them. */
    function renderEmpireDetail(empire: Empire, row: DiplomacyRow | null): void {
        const f = lay.fonts;
        const intel = empireIntel(player, empire);
        const step = lay.rowStep;
        // rect3: the stats (left column labels end at num3 = 10 + width("Government: "), right column at x3).
        const s = lay.stats;
        detail.appendChild(place(darkRect(), s.x, s.y, s.w, s.h));
        const labelRight = 10 + measure('Government: ', f.normal);
        let y = 121;
        const isSelf = empire === player;
        const capitalKnown = isSelf ? empire.capital !== null : intel.capital !== null;
        const capitalText = isSelf && empire.capital ? empireIntel(player, player).capital ?? empire.capital.name : intel.capital;
        if (empire.capital != null) valueRow(detail, 'Capital', capitalKnown ? (capitalText ?? '') : '(Unknown)', labelRight - measure(' ', f.normal), y, { size: f.normal });
        else valueRow(detail, '', '(Unknown)', labelRight, y, { size: f.normal });
        y += step;
        const govColor = intel.governmentAvailability === 3 ? 'rgb(192, 48, 48)' : intel.governmentAvailability === 2 ? 'rgb(255, 215, 0)' : TEXT;
        valueRow(detail, 'Government', intel.government, labelRight, y, { size: f.normal, valueColor: govColor });
        y += step;
        valueRow(detail, 'Reputation', intel.reputation, labelRight, y, { size: f.normal });
        y += step;
        valueRow(detail, 'Colonies', String(intel.colonies), labelRight, y, { size: f.normal });
        y += step;
        valueRow(detail, 'Population', formatMillions(intel.populationMillions), labelRight, y, { size: f.normal });
        const right = lay.column2X + measure('Military Strength: ', f.normal);
        let y2 = 121 + step;
        valueRow(detail, 'Tax Revenue', `${intel.taxRevenueK}K`, right, y2, { size: f.normal });
        y2 += step;
        valueRow(detail, 'Annual GDP', `${intel.gdpK}K`, right, y2, { size: f.normal });
        y2 += step;
        valueRow(detail, 'Strategic Value', `${intel.strategicValueK}K`, right, y2, { size: f.normal });
        y2 += step;
        valueRow(detail, 'Military Strength', String(intel.militaryStrength), right, y2, { size: f.normal });

        // rect4: Dominant Race.
        const r = lay.race;
        detail.appendChild(place(darkRect(), r.x, r.y, r.w, r.h));
        dropText(detail, 'Dominant Race', r.x + 8, r.y + 8, { size: f.header, bold: true, color: HEADER_TEXT });
        const races = empireRaces(empire);
        const dom = races[0];
        if (dom) {
            const img = place(el('img', 'dip-dom-race'), r.x + 8, r.y + 33, lay.racePicture, lay.racePicture);
            img.src = racePortraitUrl(dom.race.pictureIndex);
            img.alt = '';
            detail.appendChild(img);
            let ry = r.y + 33;
            dropText(detail, dom.race.name, lay.raceTextX, ry, { size: f.normal, bold: true, color: TEXT });
            ry += step;
            if (intel.raceFamily !== '') dropText(detail, `(${intel.raceFamily} family)`, lay.raceTextX, ry, { size: f.normal, color: TEXT });
            ry += step;
            dropText(detail, `${Math.round(dom.millions).toLocaleString('en-US')}M`, lay.raceTextX, ry, { size: f.normal, color: TEXT });
            raceCharacteristics(dom.race).forEach((line, i) => dropText(detail, line, lay.column2X, i * step + r.y + 12, { size: f.normal, bold: true, color: TEXT }));
        }
        // EmpireDetailView.cs:509-511: Empire.ResolveEmpireAbilityBonusDescriptions() at x 20, one line per num14 from
        // num27 = rect4.Top + 33 + 3 × num14 + num15 (under the race text).
        const abilityY = r.y + 33 + 3 * step + lay.raceGap;
        abilityBonusLines(empire, false).forEach((b, i) => dropText(detail, b.text, 20, abilityY + i * step, { size: f.normal, color: TEXT }));

        if (isSelf || row === null) return;

        // rect5: Current Relationship With Us.
        const rr = lay.relation;
        detail.appendChild(place(darkRect(), rr.x, rr.y, rr.w, rr.h));
        dropText(detail, 'Current Relationship With Us', 20, rr.y + 5, { size: f.header, bold: true, color: HEADER_TEXT });
        dropText(detail, row.relationText + warRowSuffix(player, empire), 25, rr.y + 28, { size: f.large, bold: true, color: rgb(row.relationColor) }); // [wargoals]
        // The player's ambassador at their capital (role / name / diplomacy bonus at rect5.Right - 88).
        const amb = ambassadorAt<Character>(player, empire);
        if (amb !== null) {
            const ax = rr.x + rr.w - 88;
            // CharacterImageCache.ObtainCharacterImageSmall (38 px, role icon) at (x - 40, y) (EmpireDetailView.cs:626-628).
            const portrait = place(characterPortrait(amb.character, 'small', CHARACTER_IMAGE_SPEC.small.bitmap), ax - 40, rr.y + 5);
            portrait.classList.add('dip-ambassador-portrait');
            portrait.title = amb.name;
            detail.appendChild(portrait);
            dropText(detail, amb.role, ax, rr.y + 5, { size: f.normal, color: TEXT });
            dropText(detail, amb.name, ax, rr.y + 5 + lay.ambassadorStep, { size: f.normal, color: TEXT });
            dropText(detail, amb.bonus, ax, rr.y + 5 + 2 * lay.ambassadorStep, { size: f.normal, color: TEXT });
        }
        let feelingY = lay.feelingY;
        if (row.incoming !== null) {
            dropText(detail, 'Treaty on Offer', 20, rr.y + 59, { size: f.header, bold: true, color: HEADER_TEXT });
            dropText(detail, row.incomingText, 25, rr.y + 84, { size: f.normal, bold: true, color: rgb(proposalColor(row.incoming.type)) });
            const other = empire;
            const accept = glassButton('Accept Offer', {
                onClick: () =>
                    issuePlayerCommand(player.galaxy, player, 'acceptProposal', [other], (ok) => {
                        if (ok) showToast('Treaty accepted');
                        render();
                    }),
                title: row.incomingMessage || undefined,
            });
            detail.appendChild(place(accept, lay.accept.x, lay.accept.y, 130, 25));
            // Our addition: decline the offer (the original only let it expire / answered it from the message).
            const decline = glassButton('Decline', { onClick: () => issuePlayerCommand(player.galaxy, player, 'declineProposal', [other], () => render()) });
            detail.appendChild(place(decline, lay.accept.x, lay.accept.y + 28, 130, 25));
            feelingY += 52;
        }
        if (row.feeling !== '') {
            feelingY += 6;
            dropText(detail, row.feeling.replace(/ \(([-+]?\d+)\)$/, ' ($1)'), 20, feelingY, { size: f.normal, bold: true, color: TEXT });
        }

        // TradeRestrictedResourcesPanel at (20, Height - (15 + its height)), 18 px a line.
        const restricted = restrictedResourceLines(player, empire);
        const restrictedH = restricted.length * 18;
        const extrasTop = feelingY + lay.factorGap;
        const extrasBottom = lay.detail.h - (restrictedH > 0 ? 15 + restrictedH + 4 : 6);
        const extras = place(scrollPanel('dip-extras'), 14, extrasTop, lay.detail.w - 22, Math.max(30, extrasBottom - extrasTop));
        extras.style.fontSize = `${f.normal}px`;
        for (const fac of row.factors) {
            const line = el('div', 'dip-factor ow-shadow', `${fac.description} (${formatSigned(fac.value)})`);
            line.style.color = fac.value < 0 ? RED : LIGHT_GREEN;
            line.style.maxWidth = `${lay.textWidth}px`;
            extras.appendChild(line);
        }
        appendExtras(extras, empire, row);
        detail.appendChild(extras);
        extras.scrollTop = extrasScroll;
        restricted.forEach((ln, i) => {
            const y0 = lay.detail.h - 15 - restrictedH + i * 18 - 6;
            if (ln.kind === 'label') dropText(detail, ln.text, 20, y0, { size: f.normal, color: TEXT, shadow: false });
            else {
                // TradeRestrictedResourcesPanel.chkTradeResources_CheckedChanged: our SupplyRestrictedResources towards
                // them (a player command, applied at the next frame boundary).
                const other = empire;
                const box = checkBox(ln.text, ln.checked, (v) => issuePlayerCommand(player.galaxy, player, 'setSupplyRestrictedResources', [other, v], () => render()), f.normal);
                box.classList.add('dip-restricted-check');
                detail.appendChild(place(box, 20, y0));
            }
        });
    }

    /** Our additions after the factors: the offer we made, our strategy, side treaties, the charter / Concord / war
     *  goal blocks and the scenario council, reputation and incident lines. */
    function appendExtras(box: HTMLElement, empire: Empire, row: DiplomacyRow): void {
        const heading = (t: string): void => {
            box.appendChild(el('div', 'diplomacy-section-heading', t));
        };
        if (row.outgoing) {
            heading('Our offer to them');
            box.appendChild(el('div', 'diplomacy-line', row.outgoingText));
        }
        box.appendChild(el('div', 'diplomacy-line diplomacy-strategy', `Our strategy: ${row.ourStrategy}`));
        if (row.treaties.length > 0) {
            heading('Treaties');
            for (const t of row.treaties) box.appendChild(el('div', 'diplomacy-line diplomacy-treaty', t));
        }
        // [charters] begin
        // Scenario 19c: a company's charter line; its founder gets a "Manage charter" link (§8.4).
        const charterLine = companyHeaderLine(player.galaxy, empire);
        if (charterLine !== '') {
            box.appendChild(el('div', 'diplomacy-line', charterLine));
            const charter = charterOfCompany(player.galaxy, empire);
            if (charter !== null && charter.founderId === player.empireId) {
                const manage = el('button', 'diplomacy-button', 'Manage charter');
                manage.type = 'button';
                manage.addEventListener('click', () => toggleChartersScreen(player.galaxy, player));
                box.appendChild(manage);
            }
        }
        // [charters] end
        // [rimTrader] begin
        const rimTerms = empire === rimTraderEmpireOf(player) ? rimTraderTermsRows(player.galaxy, player) : null;
        if (rimTerms !== null) box.appendChild(rimTraderTermsBlock(rimTerms));
        // [rimTrader] end
        // [wargoals] begin
        const war = warTermsBlock(player, empire, () => render());
        if (war !== null) box.appendChild(war);
        // [wargoals] end

        // 19o (scenario `reputationLedger`): the ledger entries the other empire holds about us, with their fade.
        const causes = reputationRows(player.galaxy, player, empire);
        if (causes.length > 0) {
            heading('Why they feel this way');
            for (const r of causes) {
                const line = el('div', 'diplomacy-factor', r.text);
                line.style.color = r.value < 0 ? RED : LIGHT_GREEN;
                box.appendChild(line);
            }
        }
        // 19d3 (scenario `espionageConsequences`): open espionage crises, recent exposures, stolen techs of the pair.
        const incidents = incidentRows(player.galaxy, player, empire);
        if (incidents.length > 0) {
            heading('Incidents');
            for (const r of incidents) {
                const line = el('div', 'diplomacy-factor', r.text);
                if (r.kind === 'crisis') line.style.color = RED;
                box.appendChild(line);
            }
        }
        // 19d8 (scenario `galacticCouncil`): the council block — members, chair, motion on the floor, last 5 results, our bloc.
        const council = councilView(player.galaxy, player);
        if (council !== null) {
            heading(council.observer ? `Council: ${council.name} (not a member)` : `Council: ${council.name}`);
            box.appendChild(el('div', 'diplomacy-line', `Chair: ${council.chair || '(none)'} — founded ${council.founded}`));
            for (const mr of council.members) {
                const tags = [mr.chair ? 'chair' : '', mr.bloc, `prestige ${mr.prestige}`, mr.losses > 0 ? `outvoted ${mr.losses}` : ''].filter((t) => t !== '').join(', ');
                box.appendChild(el('div', 'diplomacy-factor', `${mr.name} (${tags})`));
            }
            box.appendChild(el('div', 'diplomacy-line', council.motion !== '' ? `Motion: ${council.motion}` : 'Motion: (none on the floor)'));
            if (council.motionStatus !== '') box.appendChild(el('div', 'diplomacy-factor', council.motionStatus));
            // [llm] 19s-2 voices: two members speak for / against the motion (scripted at once, voiced in place).
            const speeches = council.motionRef !== null ? activeVoiceJob()?.councilSpeeches(council.councilRef!, council.motionRef, () => render()) ?? null : null;
            if (speeches !== null) {
                for (const sp of [speeches.for, speeches.against]) {
                    if (sp === null) continue;
                    const line = el('div', 'diplomacy-factor', `${sp.side === 'for' ? 'For' : 'Against'} — ${sp.speaker.name}: ${sp.text}`);
                    line.style.color = sp.side === 'for' ? LIGHT_GREEN : RED;
                    if (sp.voiced) line.title = 'Voiced by the local model';
                    box.appendChild(line);
                }
            }
            if (council.voteDecisionId > 0) {
                const buttons = el('div', 'diplomacy-buttons');
                for (const [id, label] of [['yes', 'Vote yes'], ['no', 'Vote no'], ['abstain', 'Abstain']] as const) {
                    const b = el('button', 'diplomacy-button', label);
                    b.type = 'button';
                    b.addEventListener('click', () => issuePlayerCommand(player.galaxy, player, 'answerScenarioDecision', [council.voteDecisionId, id], () => render()));
                    buttons.appendChild(b);
                }
                box.appendChild(buttons);
            }
            for (const r of council.results) {
                const line = el('div', 'diplomacy-factor', r.text);
                line.style.color = r.passed ? LIGHT_GREEN : RED;
                box.appendChild(line);
            }
            box.appendChild(el('div', 'diplomacy-line', `Our bloc: ${council.yourBloc || '(none)'}`));
            if (council.rivals.length > 0) box.appendChild(el('div', 'diplomacy-line diplomacy-muted', `Rival council: ${council.rivals.join(', ')}`));
        }
    }

    /** Pirate branch (rect2): the known bases, the playstyle, the counters, the protection arrangement and how the
     *  faction feels about us, plus our protection request / cancel (the talk panel) and price. */
    function renderPirateDetail(empire: Empire, row: DiplomacyRow | null): void {
        const f = lay.fonts;
        const pl = lay.pirate;
        detail.appendChild(place(darkRect(), pl.rect.x, pl.rect.y, pl.rect.w, pl.rect.h));
        const sc = place(scrollPanel('dip-extras dip-pirate'), pl.rect.x + 4, pl.rect.y + 4, pl.rect.w - 6, pl.rect.h - 8);
        sc.style.fontSize = `${f.normal}px`;
        const line = (t: string, o: { bold?: boolean; color?: string; size?: number; gapAfter?: number; indent?: boolean } = {}): HTMLElement => {
            const d = el('div', 'dip-pline ow-shadow', t);
            if (o.bold) d.style.fontWeight = 'bold';
            if (o.color) d.style.color = o.color;
            if (o.size) d.style.fontSize = `${o.size}px`;
            if (o.indent) d.style.paddingLeft = '20px';
            d.style.marginBottom = `${o.gapAfter ?? 0}px`;
            d.style.maxWidth = `${pl.width}px`;
            sc.appendChild(d);
            return d;
        };
        const bases: string[] = [];
        for (const b of player.knownPirateBases ?? []) {
            if (b == null || b.hasBeenDestroyed || b.empire !== empire) continue;
            const loc = b.parentHabitat ?? b.nearestSystemStar;
            if (loc == null) continue;
            const star = player.galaxy.determineHabitatSystemStar(loc);
            bases.push(`${b.name} at ${loc.name} (${star?.name ?? loc.name} system)`);
        }
        line(bases.length > 0 ? bases.join('\n') : '(Unknown pirate base)', { bold: true, gapAfter: 2 * pl.gap });
        line(`Pirate ${piratePlayStyleName(empire.piratePlayStyle)}`, { bold: true, gapAfter: pl.bigGap - pl.step });
        const c = empire.counters;
        line(`Controlled Colonies: ${empire.colonies.length}`, { indent: true, gapAfter: pl.gap });
        line(`Destroyed Ships and Bases: ${c.destroyedEnemyMilitaryShipCount + c.destroyedEnemyCivilianShipCount}`, { indent: true });
        line(`Captured Ships and Bases: ${c.captureShipCount}`, { indent: true });
        line(`Successful Raids: ${c.raidSuccessCount}`, { indent: true });
        line(`Successful Intelligence Missions: ${c.intelligenceMissionSuccessEspionageCount + c.intelligenceMissionSuccessSabotageCount}`, { indent: true, gapAfter: pl.gap });
        const intel = empireIntel(player, empire);
        line(`Military Ships: ${intel.militaryShips}     (${intel.firepower} firepower)`, { indent: true });
        const smugglers = (empire.privateBuiltObjects ?? []).filter((b) => b != null && b.role === BuiltObjectRole.Freight).length;
        line(`Smuggling Freighters: ${smugglers}`, { indent: true });
        line(`Completed Attack Missions: ${c.completedPirateMissionAttackCount}`, { indent: true });
        line(`Completed Defense Missions: ${c.completedPirateMissionDefendCount}`, { indent: true, gapAfter: pl.bigGap });
        if (row !== null) {
            if (row.pirateRelationType === PirateRelationType.Protection) {
                line(
                    player.pirateEmpireBaseHabitat !== null
                        ? 'Truce (Protection Arrangement)'
                        : row.protectionFeePerMonth > 0
                          ? `Protection Arrangement (${pirateProtectionPriceText(row.protectionFeePerMonth)})`
                          : 'Pirate truce (free protection)',
                    { size: f.header, color: TEXT, gapAfter: pl.step },
                );
            } else if (player.pirateEmpireBaseHabitat === null && !empire.pirateEmpireSuperPirates) {
                // Our addition: what a protection arrangement would cost now (per month and per year).
                const price = calculatePirateProtectionPricePerMonth(player.galaxy, empire, player).price;
                line(`Protection price now: ${price > 0 ? pirateProtectionPriceText(price) : 'Free (truce)'}`, { color: TEXT, gapAfter: pl.step });
            }
            const pr = empire.pirateRelations?.getRelationByOtherEmpire(player) ?? null;
            const evaluation = pr?.evaluation ?? 0;
            line(`${feelingDescription(Math.trunc(evaluation))} with us (${formatSigned(evaluation)})`, { bold: true, gapAfter: 4 });
        }
        if (row !== null) {
            // EmpireDetailView.cs:345-363: PlayerEmpire.DetermineEmpireRelationshipFactors(pirate) — Empire.7.cs:4270 the
            // pirate branch (their PirateRelation with us, factored), red below 0, light green otherwise.
            for (const fac of determineEmpireRelationshipFactors(player, empire)) {
                line(`${resolveGameText(fac.description)} (${formatSigned(fac.value)})`, { color: fac.value < 0 ? RED : LIGHT_GREEN });
            }
            // EmpireDetailView.cs:364-386: the attack missions we asked them for ("Pirate Attack Description New": the
            // target, its empire, the price), num7 + num5 apart.
            const attacks = empire.pirateMissions?.resolveActivitiesByType(EmpireActivityType.Attack);
            for (const a of attacks?.items ?? []) {
                if (a === null || a.requestingEmpire !== player) continue;
                const targetName = (a.target as { name?: string } | null)?.name ?? '';
                line(resolveGameText(gameTextKey('Pirate Attack Description New', targetName, a.targetEmpire?.name ?? '', String(Math.round(a.price)))), { gapAfter: pl.gap });
            }
        }
        detail.appendChild(sc);
        sc.scrollTop = extrasScroll;
        const keep = (): void => {
            extrasScroll = sc.scrollTop;
        };
        sc.addEventListener('scroll', keep);
    }

    // ---- the alliance naming panel (pnlRelationAllianceName, Main.Part2.cs:4619 method_682(false) / 4652 method_683) ----
    let allianceWin: OriginalWindow | null = null;
    function openAllianceName(empire: Empire): void {
        // ObtainDiplomaticRelation(empire): our own row and a pirate faction have no relation to name.
        if (empire === player || empire.pirateEmpireBaseHabitat !== null) return;
        allianceWin?.close();
        // 335 × 40 in game (the Locked checkbox is the Game Editor's, method_682(true)), centred on the main view.
        const w = openOriginalWindow({
            id: 'alliance-name',
            title: resolveGameText('Alliance Name'),
            headerless: true,
            width: 335,
            height: 40,
            onClose: () => {
                if (allianceWin === w) allianceWin = null;
            },
        });
        allianceWin = w;
        w.frame.classList.add('dip-alliance-name');
        // lblRelationAllianceName (10, 12) font_7; txtRelationAllianceName (110, 10) 150 × 20, (48, 48, 64) on
        // (170, 170, 170); btnRelationAllianceNameApply (265, 8) 60 × 25.
        w.body.appendChild(place(text(resolveGameText('Alliance Name'), { size: FONT.normal, color: 'rgb(170, 170, 170)', shadow: false }), 10 - 3, 12 - 3));
        let name = player.diplomaticRelations.byEmpire(empire)?.allianceName ?? '';
        const input = textBox(name, '', (v) => {
            name = v;
        });
        input.classList.add('dip-alliance-input');
        w.body.appendChild(place(input, 110 - 3, 10 - 3, 150, 20));
        const apply = (): void => {
            // method_683: the name on both relations (a player command, applied at the next frame boundary).
            issuePlayerCommand(player.galaxy, player, 'setAllianceName', [empire, name], () => render());
            w.close();
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') apply();
        });
        w.body.appendChild(place(glassButton(resolveGameText('Apply'), { onClick: apply }), 265 - 3, 8 - 3, 60, 25));
        input.focus();
        input.select();
    }

    // ---- the talk panel (pnlDiplomacyTalk, Main.Part8.cs:449 method_296) ----
    let talk: OriginalWindow | null = null;
    let talkFor: Empire | null = null;
    let talkMenu: string | null = null;
    const proposalReplies = new Map<Empire, ProposalResult>();
    let proposalVersion = 0;
    let talkBuiltKey = '';
    // [diplovoice] begin
    // 18b: the voiced line per reply (pending while the model answers; null = not voiced, the original stays).
    const voiced = new Map<ProposalResult, { pending: boolean; reply: VoicedReply | null; view: { showOriginal: boolean } }>();
    function startVoice(other: Empire, res: ProposalResult, label: string, optionId: string): void {
        if (!res.ok || res.reply === null || res.reply === 'DEAL_BEGIN') return;
        const raceName = other.dominantRace?.name ?? '';
        void diplomatVoiceConfig().then(async (cfg) => {
            if (cfg === null || closed) return;
            const set = await loadDialogSet(raceName);
            const original = set !== null ? proposalReplyText(set, res, raceName) : (res.reply ?? '');
            const state = { pending: true, reply: null as VoicedReply | null, view: { showOriginal: false } };
            voiced.set(res, state);
            proposalVersion++;
            renderTalk();
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
            renderTalk();
        });
    }
    // [diplovoice] end

    function openTalk(empire: Empire): void {
        if (empire === player) return;
        if (talk !== null && !talk.closed && talkFor === empire) return;
        talk?.close();
        talkFor = empire;
        talkMenu = null;
        talkBuiltKey = '';
        talk = openOriginalWindow({
            id: 'diplomacy-talk',
            title: empire.name,
            headerless: true,
            width: 430,
            height: 778,
            onClose: () => {
                talk = null;
                talkFor = null;
            },
        });
        // gameAudio: Main.Part8.cs:469 `if (!pnlDiplomacyTalk.Visible) method_521(empire)`.
        renderTalk();
    }

    /** The talk panel's layout: pnlDiplomacyTalkPanel 410 × 758 at (10, 10) (BackColor2 = the halved main colour),
     *  the flag 50 × 30 + name centred at y 8, the race picture 280 × 280 at y 45, the response panel (10, 335)
     *  390 × 188, the conversation options (HyperlinkOptionsBox) at (10, 528) 390 × 220. */
    function renderTalk(): void {
        if (talk === null || talk.closed || talkFor === null) return;
        const other = talkFor;
        const options: ProposalOption[] | null = listProposals(player.galaxy, player, other);
        const reply = proposalReplies.get(other) ?? null;
        const key = `${proposalVersion};${talkMenu};${player.controlDiplomacyTreaties};` + (options === null ? '…' : options.map((o) => `${o.id}|${o.label}|${o.enabled}`).join(';'));
        if (key === talkBuiltKey) return;
        talkBuiltKey = key;
        const tb = talk.body;
        tb.replaceChildren();
        tb.classList.add('dip-talk');
        const panel = gradientPanel({
            colors: ['rgb(39, 40, 44)', rgb(diplomacyBackgroundColor(other.mainColor)), 'rgb(51, 54, 61)'],
            corners: { tl: true, tr: true, br: true, bl: true },
            radius: 20,
            className: 'dip-talk-panel',
        });
        place(panel, 7, 7, 410, 758);
        tb.appendChild(panel);
        const closeBtn = el('button', 'ow-close dip-talk-close');
        closeBtn.type = 'button';
        closeBtn.title = 'Close';
        closeBtn.innerHTML = '<svg viewBox="0 0 30 30" width="30" height="30" aria-hidden="true"><rect x="2" y="2" width="26" height="26" rx="8" ry="8"/><path class="ow-close-x" d="M8 8 L22 22 M8 22 L22 8"/></svg>';
        closeBtn.addEventListener('click', () => talk?.close());
        panel.appendChild(closeBtn);

        const head = place(el('div', 'dip-talk-head'), 0, 8, 410, 34);
        head.append(flagImage(other, 50, 30, 'dip-talk-flag'), text(other.name, { size: FONT.title, bold: true, color: '#fff', className: 'dip-talk-name' }));
        panel.appendChild(head);
        const portrait = place(raceImage(other, 280, 'dip-talk-race'), 65, 45, 280, 280);
        panel.appendChild(portrait);

        // pnlDiplomaticConversationResponse (MessagePanel): 18.67 px text, padding 12, black at alpha 80.
        const resp = place(el('div', 'dip-talk-response ow-scroll'), 10, 335, 390, 188);
        panel.appendChild(resp);
        // ctlDiplomacyConversation (HyperlinkOptionsBox): yellow 18.67 px links, 5 px apart, centred vertically.
        const optsBox = place(el('div', 'dip-talk-options ow-scroll'), 10, 528, 390, 220);
        panel.appendChild(optsBox);

        const raceName = other.dominantRace?.name ?? '';
        if (reply !== null) {
            const cls = !reply.ok ? 'diplomacy-reply-error' : reply.accepted ? 'diplomacy-reply-accepted' : 'diplomacy-reply-refused';
            const line = el('div', `diplomacy-reply ${cls}`);
            const txt = el('span', 'diplomacy-reply-text', proposalReplyText(null, reply, raceName));
            line.appendChild(txt);
            resp.appendChild(line);
            // [diplovoice] begin
            const voice = voiced.get(reply);
            const isVoiced = voice !== undefined && !voice.pending && voice.reply !== null && voice.reply.voiced;
            if (isVoiced) {
                line.appendChild(voicedLineToggle(txt, voice.reply!.text, voice.reply!.original, voice.view));
                const note = counterNote(voice.reply!.counter);
                if (note !== null) resp.appendChild(note);
            } else if (voice?.pending === true) {
                line.appendChild(voicingIndicator());
            }
            // [diplovoice] end
            if (!isVoiced && reply.ok && reply.reply !== null) {
                void loadDialogSet(raceName).then((set) => {
                    txt.textContent = set !== null ? proposalReplyText(set, reply, raceName) : reply.reply;
                });
            }
            // Main.Part10.cs:4150 GenerateAutomationMessageBox("Treaty Negotiation"): offered after the action here.
            if (reply.automationPrompt && player.controlDiplomacyTreaties === AutomationLevel.FullyAutomated) {
                const auto = el('div', 'diplomacy-propose-automation');
                auto.appendChild(el('span', '', `${resolveGameText('Treaty Negotiation')} is automated`));
                const off = el('a', 'dip-talk-link', 'Turn off');
                off.href = '#';
                off.addEventListener('click', (e) => {
                    e.preventDefault();
                    issuePlayerCommand(player.galaxy, player, 'setEmpireControl', ['controlDiplomacyTreaties', MANUAL], () => {
                        proposalVersion++;
                        renderTalk();
                    });
                });
                auto.appendChild(off);
                resp.appendChild(auto);
            }
        } else {
            const intro = el('div', 'diplomacy-reply dip-talk-greeting', `${relationTypeLabel(player.diplomaticRelations.byEmpire(other)?.type ?? DiplomaticRelationType.NotMet)} — what do you wish to discuss?`);
            if (other.pirateEmpireBaseHabitat !== null) intro.textContent = 'What do you want?';
            resp.appendChild(intro);
        }
        // [diplovoice] begin
        resp.appendChild(voiceSwitch(() => {
            proposalVersion++;
            renderTalk();
        }));
        // [diplovoice] end

        const submit = (o: ProposalOption): void => {
            // Command log: queued, applied at the next frame boundary; the conversation updates then.
            issuePlayerCommand(player.galaxy, player, 'submitProposal', [other, o.id], (res) => submitted(o, res));
        };
        const submitted = (o: ProposalOption, res: ProposalResult): void => {
            proposalReplies.set(other, res);
            proposalVersion++;
            talkMenu = null;
            if (res.expireMessagesFor !== null) expireDiplomacyMessages?.(res.expireMessagesFor);
            // [diplovoice] begin
            startVoice(other, res, resolveGameText(o.label), o.id);
            // [diplovoice] end
            // [tradenego] begin
            // DEAL_BEGIN (Main.Part10.cs:4324 method_302): the trade trees open beside the conversation — not when the
            // screen or its conversation closed before the reply came (one worker round trip later on a replica).
            if (res.trade !== null && !closed && talk !== null && !talk.closed) {
                openTradePanel({
                    galaxy: player.galaxy,
                    negotiation: res.trade,
                    resolveReply: (part: DialogPartType, e: Empire) => {
                        const rn = e.dominantRace?.name ?? '';
                        return loadDialogSet(rn).then((set) => (set !== null ? formatNet(set.resolveDialog(part, rn), []) : part));
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
                        renderTalk();
                        render();
                    },
                });
            }
            // [tradenego] end
            renderTalk();
            render();
        };
        const link = (label: string, onClick: (() => void) | null, hint = ''): HTMLElement => {
            const a = el('a', `dip-talk-link${onClick === null ? ' dip-talk-disabled' : ''}`, label);
            a.href = '#';
            if (hint) a.title = hint;
            a.addEventListener('click', (e) => {
                e.preventDefault();
                onClick?.();
            });
            return a;
        };
        const optionLink = (o: ProposalOption): HTMLElement => {
            // A priced pirate protection option also names the price per year (the label has it per month).
            const yearly = o.part === 'PIRATE_PROTECTIONPROPOSE_OFFER' || o.part === 'PIRATE_PROTECTIONACCEPTRESPONSE' ? pirateProtectionYearlySuffix(o.cost) : '';
            const a = link(resolveGameText(o.label) + yearly, o.enabled ? () => submit(o) : null, o.hint ?? '');
            a.classList.add('diplomacy-propose-option');
            return a;
        };
        const inner = el('div', 'dip-talk-options-inner');
        optsBox.appendChild(inner);
        if (reply !== null && reply.followUps.length > 0) {
            for (const f of reply.followUps) inner.appendChild(optionLink(f));
        } else if (options === null) {
            inner.appendChild(el('div', 'dip-talk-none', '…'));
        } else {
            const groups = proposalGroups(options);
            const group = talkMenu !== null ? groups.find((g) => g.label === talkMenu) ?? null : null;
            if (group !== null) {
                for (const o of group.options) inner.appendChild(optionLink(o));
                inner.appendChild(
                    link('(Back)', () => {
                        talkMenu = null;
                        renderTalk();
                    }),
                );
            } else {
                if (groups.length === 0) inner.appendChild(el('div', 'dip-talk-none', '(nothing to propose)'));
                for (const g of groups) {
                    // A one-option entry whose label is the option itself submits at once (Main.Part9.cs:208 menu).
                    if (g.options.length === 1 && g.options[0].label === g.label) inner.appendChild(optionLink(g.options[0]));
                    else
                        inner.appendChild(
                            link(resolveGameText(g.label), () => {
                                talkMenu = g.label;
                                renderTalk();
                            }),
                        );
                }
            }
        }
        inner.appendChild(link('Goodbye', () => talk?.close()));
    }

    build();
    if (opts.selectedEmpire) list.grid.select(selected, true);
    const timer = setInterval(() => {
        render();
        renderTalk();
    }, 1000);

    return {
        close: () => win.close(),
        select: (empire: Empire) => select(empire, true),
    };
}

/** EmpireDetailView treaty-on-offer colours (text14's colour2): the relation colours, None offers in grey. */
function proposalColor(type: DiplomaticRelationType): number {
    return type === DiplomaticRelationType.None ? 0x808080 : RELATION_COLORS[type];
}

/** The first known, intact base of a pirate faction (its habitat, for go-to). */
function knownPirateBaseOf(player: Empire, pirate: Empire): Habitat | null {
    for (const b of player.knownPirateBases ?? []) {
        if (b != null && !b.hasBeenDestroyed && b.empire === pirate && b.parentHabitat != null) return b.parentHabitat;
    }
    return null;
}

let measureCtx: CanvasRenderingContext2D | null = null;
/** Graphics.MeasureString(text, font, …, GenericTypographic).Width in the game font. */
function measure(t: string, size: number, bold = false): number {
    measureCtx ??= document.createElement('canvas').getContext('2d');
    if (!measureCtx) return t.length * size * 0.5;
    measureCtx.font = `${bold ? 'bold ' : ''}${size}px 'Forgotten Futurist', sans-serif`;
    return Math.ceil(measureCtx.measureText(t).width);
}

/** TradeRestrictedResourcesPanel.BindSettings: what they supply of the super-luxury resources (and whether they trade
 *  them with us), and the ones we supply (the checkbox, our SupplyRestrictedResources towards them). */
function restrictedResourceLines(player: Empire, empire: Empire): ({ kind: 'label'; text: string } | { kind: 'check'; text: string; checked: boolean })[] {
    const galaxy = player.galaxy;
    const supers = galaxy.resourceSystem?.superLuxuryResources ?? [];
    if (supers.length === 0) return [];
    const names = (e: Empire): string =>
        supers
            .filter((r) => determineResourcesEmpireSupplies(e).includes(r.resourceId))
            .map((r) => r.name)
            .join(', ');
    const out: ({ kind: 'label'; text: string } | { kind: 'check'; text: string; checked: boolean })[] = [];
    const theirs = names(empire);
    if (theirs !== '') {
        const rel = empire.diplomaticRelations.byEmpire(player);
        out.push({ kind: 'label', text: resolveGameText(gameTextKey(rel?.supplyRestrictedResources ? 'Restricted Resource Trade Description' : 'Restricted Resource Trade Refuse Description', theirs)) });
    }
    const ours = names(player);
    if (ours !== '') out.push({ kind: 'check', text: resolveGameText(gameTextKey('Restricted Resource Trade Us Description', ours)), checked: player.diplomaticRelations.byEmpire(empire)?.supplyRestrictedResources === true });
    return out;
}
