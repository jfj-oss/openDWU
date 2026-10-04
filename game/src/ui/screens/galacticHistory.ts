// Galactic History screen: the original's pnlMessageHistory opened by btnGalacticHistory (Main.Part3.cs:46
// btnGalacticHistory_Click → Main.Part4.cs:1856 method_528("galactichistory")) — the player's saved
// Empire.MessageHistory in an EmpireMessageListView (Icon | Subject | Star Date), a filter combo
// (All / Non-Battle / Galactic History), the selected message's title + text, the small galaxy map with the message's
// location (gmapMessageHistory) and Go to Location. Built on the shared original-style window (originalWindow.ts:
// ScreenPanel 965 × 580, OwGrid, dropDown, glassButton) at method_528's positions. Our additions keep the same look: a tab
// strip (EnhancedTabControl) above the original layout for Chronicle / Ask / Orders (19s) and Battle Reports
// ([improvements]), each tab laid out on the same grid as the History page.

import './galacticHistory.css';
import { EmpireMessageType, empireMessageHistory, type EmpireMessage } from '../../sim/messages';
// The rebind's RemoveOldHistoryMessages is game state: the journaled removeOldHistoryMessages command (both modes).
import { trimMessageHistory, trimmedHistoryView } from '../messagePipeline';
import { Empire } from '../../sim/empire';
import { BuiltObject } from '../../sim/builtObject';
import { Habitat } from '../../sim/types';
import { PlanetaryFacility } from '../../sim/construction/facilities';
import type { Facility } from '../../sim/data/facilities';
import { DiplomaticRelationType } from '../../sim/diplomacy';
import { TradeableItem, TradeableItemType } from '../../sim/tradeItems';
import { BuiltObjectRole } from '../../sim/data/designSpecifications';
import { netSort } from '../../sim/netSort';
import { resolveStarDateDescription } from '../../sim/galaxyTime';
import { formatNet, resolveGameText, tryGetText } from '../../sim/textResolver';
import type { Galaxy } from '../../sim/galaxy';
import { EVENT_CATEGORIES, eventLogEntries, eventLogOn, eventsKnownTo, findEmpireById, type EventCategory, type EventLogEntry } from '../../sim/scenario/eventLog/log';
import { categoryLabel, resolveEntryText, resolveEntryTitle } from '../../sim/scenario/eventLog/chronicle';
import { chronicleMarkdown, chronicleOn, chronicleYears, dueChronicleYear } from '../../sim/scenario/llm/chronicle';
import { archiveLineText, archiveQuestionsOn, archivistOn } from '../../sim/scenario/llm/archive';
import type { PendingOrder } from '../../sim/scenario/llm/orderMenu';
import { askArchivist } from '../../llm/archivist';
import { confirmOrder, interpretOrder } from '../../llm/orders';
import { currentLlmLayer } from '../../llm/llmLayer';
import { advisorSelectionFromHud } from '../advisorPanel';
import { battleReportsOn } from '../battleReports';
import { battleReports as listBattleReports, type BattleReport } from '../../sim/battleReports/battleReports';
import { battleListTitle, battleReportSummary, RESULT_COLORS, RESULT_LABELS } from './battleReportModel';
import { openBattleReport } from './battleReport';
import { IMPROVEMENTS_TITLE } from '../improvements';
import {
    chromeImageUrl,
    dropDown,
    el as owEl,
    FONT,
    glassButton,
    openOriginalWindow,
    OwGrid,
    place,
    rgbCss,
    scrollPanel,
    setText,
    tabStrip,
    text as owText,
    textBox,
    type GridColumn,
    type OriginalWindow,
} from '../originalWindow';
import { CROSSHAIR_COLOR, GRID_COLOR, galaxyMapScale, starBrushColor, starDotSizes } from './galaxyMap';
import { drawGalaxyMapLayers } from './galaxyMapLayers';
import { empireFlagUrl } from '../selectionInfoView';

/** [improvements] The Battle Reports tab's rows, newest first (skirmishes when asked). */
export function battleReportRows(galaxy: Galaxy, withSkirmishes: boolean): { report: BattleReport; title: string; date: string; color: string }[] {
    return listBattleReports(galaxy, withSkirmishes).map((r) => ({ report: r, title: battleListTitle(r), date: resolveStarDateDescription(r.endStarDate), color: RESULT_COLORS[r.result] }));
}

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

/** cmbMessageHistoryFilter items (Main.Part4.cs:1874-1879), by SelectedIndex. */
export enum HistoryFilter {
    All = 0,
    NonBattle = 1,
    GalacticHistory = 2,
}

export const HISTORY_FILTER_LABELS: readonly string[] = ['Show All Messages', 'Show Non-Battle Messages', 'Show Galactic History Messages'];

/** Panel header: "Galactic History" for the Galactic History filter, else "Messages" (Main.Part4.cs:2998-3006). */
export function historyHeaderTitle(filter: HistoryFilter): string {
    return text(filter === HistoryFilter.GalacticHistory ? 'Galactic History' : 'Messages');
}

function text(tag: string, ...args: unknown[]): string {
    const t = tryGetText(tag) ?? tag;
    return args.length > 0 ? formatNet(t, args) : t;
}

/**
 * Port of Main.Part4.cs:2986 method_542: MessageHistory sorted by StarDate (EmpireMessage.cs:261, List.Sort) then
 * reversed (newest first), filtered — Non-Battle drops BattleAttacking / BattleUnderAttack / IncomingEnemyFleet
 * (any filter above All), Galactic History keeps only GalacticHistory messages. The C# sorts the empire's list in place;
 * this sorts a copy (same order).
 */
export function filterHistoryMessages(history: readonly EmpireMessage[], filter: HistoryFilter): EmpireMessage[] {
    const sorted = history.filter((m) => m != null);
    netSort(sorted, (a, b) => (a.starDate < b.starDate ? -1 : a.starDate > b.starDate ? 1 : 0));
    sorted.reverse();
    const nonBattle = filter > HistoryFilter.All;
    const galacticOnly = filter === HistoryFilter.GalacticHistory;
    return sorted.filter((m) => {
        if (nonBattle && (m.messageType === EmpireMessageType.BattleAttacking || m.messageType === EmpireMessageType.BattleUnderAttack || m.messageType === EmpireMessageType.IncomingEnemyFleet)) return false;
        if (galacticOnly && m.messageType !== EmpireMessageType.GalacticHistory) return false;
        return true;
    });
}

/**
 * Port of Main.Part9.cs:1061-1507 (ReceiveMessageInternal): the Title a message without one is given when the
 * player receives it. The C# writes it into the message; the screen only displays it.
 */
export function defaultMessageTitle(m: EmpireMessage, player: Empire | null): string {
    const T = EmpireMessageType;
    const subject = m.subject;
    const treatyTitle = (fallback: string): string => {
        if (typeof subject === 'number') {
            switch (subject as DiplomaticRelationType) {
                case DiplomaticRelationType.FreeTradeAgreement: return text('Free Trade Agreement Offered');
                case DiplomaticRelationType.MutualDefensePact: return text('Mutual Defense Pact Offered');
                case DiplomaticRelationType.SubjugatedDominion: return text('Subjugation proposed');
                case DiplomaticRelationType.Protectorate: return text('Protectorate Offered');
                case DiplomaticRelationType.TradeSanctions: return text('Trade Sanctions Imposed');
                case DiplomaticRelationType.War: return text('War Declared!');
            }
        }
        return text(fallback);
    };
    const isBase = subject instanceof BuiltObject && subject.role === BuiltObjectRole.Base;
    switch (m.messageType) {
        case T.DiplomaticRelationChange: return treatyTitle('Diplomatic Relation Change');
        case T.ProposeDiplomaticRelation: return treatyTitle('Treaty proposed');
        case T.AcceptDiplomaticRelation: return text('Treaty accepted');
        case T.RefuseDiplomaticRelation: return text('Treaty refused');
        case T.RemoveColoniesFromSystem: return text('Request to remove presence from system');
        case T.StopMissionsAgainstUs: return text('Warning to stop intelligence missions');
        case T.StopAttacks: return text('Warning to stop attacks');
        case T.LeaveSystem: return text('Request to Leave System');
        case T.RequestJointWar: return text('Request to Declare War');
        case T.RequestJointTradeSanctions: return text('Request to impose Trade Sanctions');
        case T.RequestStopWar: return text('Request to end War');
        case T.RequestLiftTradeSanctions: return text('Request to lift Trade Sanctions');
        case T.GiveGift: return text('Monetary Gift');
        case T.Informational: return text('General Information');
        case T.ShipBaseCompleted: return text('Ship completed');
        case T.ShipBasePurchased: return text('Ship purchased');
        case T.NewColony: return text('New colony established');
        case T.NewColonyFailed: return text('Colonization failed');
        case T.ResearchBreakthrough: return text('Research Breakthrough');
        case T.BattleUnderAttack: return text('Under attack!');
        case T.BattleAttacking: return text('Attacking enemy');
        case T.IncomingEnemyFleet: return text('Incoming Enemy Fleet!');
        case T.CharacterAppearance: return text('Character Appears');
        case T.CharacterDeath: return text('Character Killed');
        case T.CharacterMissionAccomplished: return text('Agent mission succeeds');
        case T.CharacterMissionFailure: return text('Agent mission fails');
        case T.EmpireDiscovered: return text('New empire encountered');
        case T.ColonyGained: return text('Colony gained');
        case T.ColonyLost: return text('Colony lost!');
        case T.ColonyDefended: return text('Colony defends against invasion!');
        case T.ColonyRebelling: return text('Colony rebelling!');
        case T.EmpireDefeated: return text('Empire Defeated!');
        case T.RequestHonorMutualDefense: return text('Request to honor Mutual Defense Pact');
        case T.BlockadeInitiated: return text('Blockade begins');
        case T.BlockadeCancelled: return text('Blockade ends');
        case T.ExplorationRuins: return text('Ruins discovered');
        case T.ExplorationBuiltObject: return text('Ship discovered');
        case T.ExplorationHabitat: return text('Planet discovered');
        case T.ExplorationLocation: return text('Location discovered');
        case T.GalacticHistory: return text('Galactic History revealed');
        case T.SellInfoUnmetEmpire: return text('Pirates Offer Empire Contact');
        case T.SellInfoIndependentColony: return text('Pirates Offer Colony Location');
        case T.SellInfoSystemMap: return text('Pirates Offer System Map');
        case T.SellInfoRuins:
        case T.SellInfoDebrisField:
        case T.SellInfoRestrictedArea:
        case T.SellInfoPlanetDestroyer:
            return text('Pirates Offer Discovery');
        case T.PirateOfferProtection: return text(player?.pirateEmpireBaseHabitat != null ? 'Pirates Offer Truce' : 'Pirates Offer Protection');
        case T.CancelPirateProtection: return text('Cancel Pirate Protection Title');
        case T.Revolution: return text('Revolution! Our government has changed');
        case T.RestrictedResourceDiscovered: return text('Valuable Resource Discovered');
        case T.RestrictedResourceTradingAllowed: return text('Valuable Resource Traded with Us');
        case T.RestrictedResourceTradingBlocked: return text('Valuable Resource Trading Terminated');
        case T.OfferTrade: {
            if (Array.isArray(subject)) return text('Trade Deal offered');
            if (subject instanceof TradeableItem) {
                switch (subject.type) {
                    case TradeableItemType.ResearchProject: {
                        const node = subject.item as { def?: { name?: string }; name?: string } | null;
                        return text('Technology offered', node?.def?.name ?? node?.name ?? '');
                    }
                    case TradeableItemType.TerritoryMap: return text('Territory Map swap offered');
                    case TradeableItemType.GalaxyMap: return text('Galaxy Map swap offered');
                }
            }
            return '';
        }
        case T.ShipMissionComplete: return text('Ship Mission Complete');
        case T.ShipNeedsRefuelling: return text('Ship needs Refuelling');
        case T.ShipNeedsRepair: return text('Ship Stranded');
        case T.RemoveForcesFromSystem: return text('Remove Military forces from System');
        case T.GeneralWarning: return text("You've been warned!");
        case T.GeneralBadEvent: return text('Catastrophe!');
        case T.GeneralNeutralEvent: return '';
        case T.GeneralGoodEvent: return text('Celebration!');
        case T.GeneralDecision: return text('You must decide...');
        case T.HistoryOfferLocationHint: return text('Secret location offered');
        case T.HistoryOfferStoryClue: return text('Secret history offered');
        case T.ColonyFacilityCompleted: return text('Planetary Facility completed');
        case T.ColonyFacilityCancelled: return text('Wonder cancelled');
        case T.ColonyWonderBegun: return text('Wonder begun');
        case T.ColonyShipMissionCancelled: return text('Colony ship failed to colonize');
        case T.StoryMessage: return text('Secret Warning offered');
        case T.AdvisorSuggestion: return text('Advisor Suggestion');
        case T.ColonyDestroyed: return text('Colony Destroyed') + '!';
        case T.MilitaryRefuelingAllowed: return text('Military Refueling Allowed with Us');
        case T.MilitaryRefuelingBlocked: return text('Military Refueling Blocked with Us');
        case T.MiningRightsAllowed: return text('Mining Rights Allowed with Us');
        case T.MiningRightsBlocked: return text('Mining Rights Blocked with Us');
        case T.CharacterSkillTraitChange: return text('Character promotion');
        case T.ResearchCriticalBreakthrough: return text('Research Critical Breakthrough');
        case T.ResearchCriticalFailure: return text('Research Critical Failure');
        case T.GalacticNewsNet: return text('Galactic NewsNet');
        case T.ShipBaseBoardedCaptured: return text(isBase ? 'Enemy Base captured' : 'Enemy Ship captured') + '!';
        case T.ShipBaseBoardedLost: return text(isBase ? 'Base boarded and lost' : 'Ship boarded and lost') + '!';
        case T.PirateAttackMissionAvailable: return text('Pirate Attack Mission Available Title');
        case T.PirateAttackMissionCompleted: return text('Pirate Attack Mission Completed Title');
        case T.PirateAttackMissionFailed: return text('Pirate Attack Mission Failed Title');
        case T.PirateDefendMissionFailed: return text('Pirate Defend Mission Failed Title');
        case T.PirateDefendMissionAvailable: return text('Pirate Defend Mission Available Title');
        case T.PirateDefendMissionCompleted: return text('Pirate Defend Mission Completed Title');
        case T.PirateSmugglingMissionAvailable: return text('Pirate Smuggle Mission Available Title');
        case T.PirateSmugglingMissionCompleted: return text('Pirate Smuggle Mission Completed Title');
        case T.PirateSmugglerDetected: return text('Pirate Smuggler Detected') + '!';
        case T.PlanetaryFacilityDestroyed: return text('Planetary Facility destroyed');
        case T.ShipBaseScrapped: return text(isBase ? 'Captured Base Scrapped' : 'Captured Ship Scrapped') + '!';
        case T.ConstructionResourceShortage:
            if (subject instanceof BuiltObject || subject instanceof Habitat) return text('Construction Resource Shortage at X', subject.name);
            return '';
        case T.RaidBonuses: return text('Raid Bonuses Title');
        case T.RaidVictim: return text('Raid Victim Title');
        case T.PlanetaryFacilityDamaged: return text('Planetary Facility damaged');
        default: return '';
    }
}

/** The Subject column text: the message's Title, or the one ReceiveMessageInternal would have given it. */
export function messageTitle(m: EmpireMessage, player: Empire | null): string {
    return m.title !== '' ? resolveGameText(m.title) : defaultMessageTitle(m, player);
}

/** images/ui/messages files by bitmap_28 index (the message images, loaded in that order). */
const MESSAGE_IMAGES: readonly string[] = [
    'underAttack', 'colonygain', 'colonyloss', 'declarewar', 'endwar', 'freetradeagreement', 'mutualdefensepact', 'protectorate',
    'researchbreakthrough', 'resumetrade', 'subjugateddominion', 'tradesanctions', 'canceltreaty', 'treatyrefused', 'money', 'warning',
    'construction', 'request', 'agentsuccess', 'agentfailure', 'blockade', 'blockadecancelled', 'restrictedArea', 'agentalert',
    'explorationDiscovery', 'galacticHistory', 'information', 'pirateMessage', 'planetdestroy', 'galacticnewsnet', 'construction_stalled',
];

export type HistoryIcon = { kind: 'image'; url: string } | { kind: 'flag'; empire: Empire };

const messageImage = (i: number): HistoryIcon => ({ kind: 'image', url: `/assets/dwu/images/ui/messages/${MESSAGE_IMAGES[i]}.png` });
const facilityImage = (pictureRef: number): HistoryIcon => ({ kind: 'image', url: `/assets/dwu/images/environment/planetaryfacilities/facility_${pictureRef}.png` });
const flag = (e: Empire | null, fallback: HistoryIcon | null = null): HistoryIcon | null => (e !== null ? { kind: 'flag', empire: e } : fallback);

/**
 * Port of EmpireMessageListView.cs:110-330 BindData's Icon column. An empire's LargeFlagPicture is shown as the empire
 * colour swatch (the flag art is not composed yet); a character's portrait falls back to the message image.
 */
export function messageIcon(m: EmpireMessage): HistoryIcon | null {
    const T = EmpireMessageType;
    const subject = m.subject;
    switch (m.messageType) {
        case T.DiplomaticRelationChange:
        case T.ProposeDiplomaticRelation:
        case T.AcceptDiplomaticRelation:
        case T.RefuseDiplomaticRelation:
        case T.CancelPirateProtection:
            // 116-117: the flag is computed, then overwritten by _MessageImages[16].
            return messageImage(16);
        case T.RemoveColoniesFromSystem:
        case T.StopMissionsAgainstUs:
        case T.StopAttacks:
        case T.LeaveSystem:
            return messageImage(15);
        case T.RequestJointWar:
        case T.RequestJointTradeSanctions:
        case T.RequestStopWar:
        case T.RequestLiftTradeSanctions:
        case T.RequestHonorMutualDefense:
            return messageImage(17);
        case T.GiveGift: return messageImage(14);
        case T.Informational: return messageImage(26);
        case T.ShipBaseCompleted:
        case T.ShipBaseScrapped:
            return messageImage(16);
        case T.NewColony:
        case T.ColonyGained:
            return messageImage(1);
        case T.NewColonyFailed:
        case T.ColonyLost:
        case T.ColonyDefended:
        case T.ColonyRebelling:
        case T.Revolution:
        case T.ColonyShipMissionCancelled:
            return messageImage(2);
        case T.ResearchBreakthrough:
        case T.ResearchCriticalBreakthrough:
        case T.ResearchCriticalFailure:
            return messageImage(8);
        case T.BattleUnderAttack:
        case T.BattleAttacking:
        case T.IncomingEnemyFleet:
            return messageImage(0);
        case T.CharacterAppearance:
        case T.CharacterSkillTraitChange:
        case T.CharacterMissionAccomplished:
            return messageImage(18);
        case T.CharacterDeath: return messageImage(19);
        case T.CharacterMissionFailure: return messageImage(23);
        case T.EmpireDiscovered:
        case T.EmpireDefeated:
            return subject instanceof Empire ? flag(subject) : messageImage(13);
        case T.BlockadeInitiated: return messageImage(20);
        case T.BlockadeCancelled: return messageImage(21);
        case T.ExplorationRuins:
        case T.ExplorationBuiltObject:
        case T.ExplorationHabitat:
        case T.ExplorationLocation:
        case T.RestrictedResourceDiscovered:
            return messageImage(24);
        case T.GalacticHistory:
        case T.HistoryOfferLocationHint:
        case T.HistoryOfferStoryClue:
        case T.StoryMessage:
            return messageImage(25);
        case T.SellInfoUnmetEmpire:
        case T.SellInfoIndependentColony:
        case T.SellInfoSystemMap:
        case T.SellInfoRuins:
        case T.SellInfoDebrisField:
        case T.SellInfoRestrictedArea:
        case T.SellInfoPlanetDestroyer:
        case T.PirateOfferProtection:
            return flag(m.sender, messageImage(27));
        case T.RestrictedResourceTradingAllowed:
        case T.RestrictedResourceTradingBlocked:
        case T.MilitaryRefuelingAllowed:
        case T.MilitaryRefuelingBlocked:
        case T.MiningRightsAllowed:
        case T.MiningRightsBlocked:
        case T.OfferTrade:
        case T.RemoveForcesFromSystem:
        case T.GeneralWarning:
        case T.GeneralBadEvent:
        case T.GeneralGoodEvent:
            return flag(m.sender);
        case T.ShipMissionComplete:
        case T.ShipNeedsRefuelling:
        case T.ShipNeedsRepair:
        case T.GeneralNeutralEvent:
        case T.GeneralDecision:
            return messageImage(26);
        case T.ColonyFacilityCompleted:
        case T.ColonyFacilityCancelled:
        case T.ColonyWonderBegun:
        case T.PlanetaryFacilityDestroyed:
        case T.PlanetaryFacilityDamaged: {
            if (subject instanceof Habitat) {
                const f = subject.facilities;
                return f !== null && f.length > 0 ? facilityImage(f[f.length - 1].def.pictureRef) : null;
            }
            if (subject instanceof PlanetaryFacility) return facilityImage(subject.def.pictureRef);
            if (subject !== null && typeof subject === 'object' && 'facilityId' in subject && 'pictureRef' in subject) return facilityImage((subject as Facility).pictureRef);
            return messageImage(16);
        }
        case T.AdvisorSuggestion: return messageImage(16);
        case T.ColonyDestroyed: return messageImage(28);
        case T.GalacticNewsNet: return messageImage(29);
        case T.ShipBaseBoardedCaptured:
        case T.ShipBaseBoardedLost:
        case T.PirateSmugglerDetected:
            return messageImage(0);
        case T.PirateAttackMissionAvailable:
        case T.PirateAttackMissionCompleted:
        case T.PirateDefendMissionAvailable:
        case T.PirateDefendMissionCompleted:
        case T.PirateSmugglingMissionAvailable:
        case T.PirateSmugglingMissionCompleted:
            return messageImage(14);
        case T.PirateAttackMissionFailed:
        case T.PirateDefendMissionFailed:
        case T.RaidBonuses:
        case T.RaidVictim:
            return messageImage(27);
        case T.ConstructionResourceShortage: return messageImage(30);
        default: return null;
    }
}

/** Port of Main.Part4.cs:1946 method_530: the message's Location, else its BuiltObject / Habitat subject's position;
 *  null for Point.Empty (Go To disabled, 1987-1994). */
export function messageLocation(m: EmpireMessage): { x: number; y: number } | null {
    const loc = m.location;
    if (loc.x !== 0 || loc.y !== 0) return { x: loc.x, y: loc.y };
    const s = m.subject;
    if (s instanceof BuiltObject || s instanceof Habitat) {
        // (int) casts of Xpos / Ypos.
        const x = Math.trunc(s.xpos);
        const y = Math.trunc(s.ypos);
        return x !== 0 || y !== 0 ? { x, y } : null;
    }
    return null;
}

export interface GalacticHistoryRow {
    message: EmpireMessage;
    title: string;
    starDate: number;
    /** Galaxy.ResolveStarDateDescription(StarDate). */
    date: string;
    icon: HistoryIcon | null;
}

export type HistorySortColumn = 'title' | 'starDate';
export interface HistorySort {
    column: HistorySortColumn;
    ascending: boolean;
}

/** Rows for the list (method_542 order). */
export function galacticHistoryRows(player: Empire, filter: HistoryFilter, history: readonly EmpireMessage[] = empireMessageHistory(player)): GalacticHistoryRow[] {
    return filterHistoryMessages(history, filter).map((m) => ({
        message: m,
        title: messageTitle(m, player),
        starDate: m.starDate,
        date: resolveStarDateDescription(m.starDate),
        icon: messageIcon(m),
    }));
}

/**
 * The Subject / Star Date columns' SortMode.Automatic (EmpireMessageListView.cs:56/65; RememberSorting keeps the
 * user's choice across rebinds; the Icon column is NotSortable). Star Date sorts by the date itself. Stable, so equal
 * keys keep method_542's newest-first order. null = the unsorted method_542 order.
 */
export function sortHistoryRows(rows: readonly GalacticHistoryRow[], sort: HistorySort | null): GalacticHistoryRow[] {
    const out = rows.slice();
    if (sort === null) return out;
    const dir = sort.ascending ? 1 : -1;
    out.sort((a, b) => {
        const c = sort.column === 'title' ? a.title.localeCompare(b.title) : a.starDate - b.starDate;
        return c * dir;
    });
    return out;
}

/** Clicking a column header: first click ascending, then toggles (DataGridView automatic sort). */
export function nextHistorySort(current: HistorySort | null, column: HistorySortColumn): HistorySort {
    if (current !== null && current.column === column) return { column, ascending: !current.ascending };
    return { column, ascending: true };
}

// ---------------------------------------------------------------------------
// 19p event log (flag eventLog): the log-backed list — a category filter and an importance sort. Not a port; with
// the flag off the screen is the faithful method_542 list above.
// ---------------------------------------------------------------------------

export type HistoryCategoryFilter = EventCategory | 'all';
export type HistoryLogSort = 'date' | 'importance';

export interface EventLogHistoryRow {
    entry: EventLogEntry;
    title: string;
    text: string;
    starDate: number;
    date: string;
    category: EventCategory;
    categoryLabel: string;
    importance: number;
    location: { x: number; y: number } | null;
    icon: HistoryIcon | null;
}

/** True when the screen lists the event log instead of Empire.MessageHistory. */
export function galacticHistoryUsesEventLog(galaxy: Galaxy | null | undefined): boolean {
    return eventLogOn(galaxy);
}

/** The category filter's choices: All, then every category in EVENT_CATEGORIES order. */
export function historyCategoryOptions(): { value: HistoryCategoryFilter; label: string }[] {
    return [{ value: 'all', label: tryGetText('EventLog All Categories') ?? 'All Categories' }, ...EVENT_CATEGORIES.map((c) => ({ value: c, label: categoryLabel(c) }))];
}

/**
 * Rows for the log-backed list (DOM-free): what the player was told or took part in (log.ts eventsKnownTo), filtered
 * by category; `date` = newest first, `importance` = most important first, newest first within a level.
 */
export function eventLogHistoryRows(galaxy: Galaxy, player: Empire, category: HistoryCategoryFilter, sort: HistoryLogSort): EventLogHistoryRow[] {
    const entries = eventsKnownTo(galaxy, player).filter((e) => category === 'all' || e.category === category);
    const ordered = entries.slice().reverse(); // newest first (the log is append-ordered)
    if (sort === 'importance') ordered.sort((a, b) => b.importance - a.importance); // stable: newest first within a level
    return ordered.map((e) => {
        const firstEmpire = e.actors.find((a) => a.kind !== 'character');
        const emp = firstEmpire !== undefined ? findEmpireById(galaxy, firstEmpire.id) : null;
        const p = e.place;
        return {
            entry: e,
            title: resolveEntryTitle(e),
            text: resolveEntryText(e),
            starDate: e.starDate,
            date: resolveStarDateDescription(e.starDate),
            category: e.category,
            categoryLabel: categoryLabel(e.category),
            importance: e.importance,
            location: p !== null && (p.x !== 0 || p.y !== 0) ? { x: p.x, y: p.y } : null,
            icon: flag(emp),
        };
    });
}

// 19s-1 Chronicle tab (flag llmFoundations + eventLog): the yearly in-character history (llm/chronicleJob.ts writes it).
// Not a port; with the flag off the tab does not exist.

export interface ChronicleRow {
    year: number;
    title: string;
    text: string;
    /** 'model' | 'fallback' | 'pending' (the year is over and the chronicler is still writing). */
    source: 'model' | 'fallback' | 'pending';
}

/** True when the screen shows the Chronicle tab. */
export function galacticHistoryHasChronicle(galaxy: Galaxy | null | undefined): boolean {
    return chronicleOn(galaxy);
}

export type GalacticHistoryTab = 'history' | 'chronicle' | 'ask' | 'orders' | 'battles';

/** The screen's tabs: History always; Chronicle (19s-1), Ask and Orders (19s-4, flag llmArchivist) when on. */
export function galacticHistoryTabs(galaxy: Galaxy | null | undefined): GalacticHistoryTab[] {
    const tabs: GalacticHistoryTab[] = ['history'];
    if (chronicleOn(galaxy)) tabs.push('chronicle');
    if (archiveQuestionsOn(galaxy)) tabs.push('ask');
    if (archivistOn(galaxy)) tabs.push('orders');
    // [improvements] Battle Reports (DW2-inspired, ui/battleReports.ts): while the improvement is on.
    if (battleReportsOn()) tabs.push('battles');
    return tabs;
}

/** The Chronicle tab's rows, newest year first; a 'pending' row leads while a finished year is not written yet. */
export function chronicleRows(galaxy: Galaxy, empire: Empire): ChronicleRow[] {
    const rows: ChronicleRow[] = chronicleYears(galaxy, empire)
        .map((c) => ({ year: c.year, title: c.title, text: c.text, source: c.source }))
        .reverse();
    const due = dueChronicleYear(galaxy, empire);
    if (due !== null) rows.unshift({ year: due, title: tryGetText('Chronicle Pending') ?? 'The chronicler is still writing…', text: '', source: 'pending' });
    return rows;
}

/** File name of the markdown export. */
export function chronicleFileName(empire: Empire): string {
    return `chronicle-${empire.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'empire'}.md`;
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

export interface GalacticHistoryOptions {
    empire: Empire;
    /** btnMessageHistoryGoto (Main.Part4.cs:1967): move the view to the point at planet zoom (method_156 + method_4(1.0)). */
    onGoTo: (x: number, y: number) => void;
    /** method_528's argument (default "galactichistory", btnGalacticHistory); H and btnHistoryMessages pass "either". */
    mode?: HistoryOpenMode;
    /** An explicit initial filter (tests); wins over `mode`. */
    filter?: HistoryFilter;
}

/** The method_528(string_30) arguments (Main.Part4.cs:1884-1904). */
export type HistoryOpenMode = 'galactichistory' | 'nonbattle' | 'all' | 'either';

/**
 * cmbMessageHistoryFilter.SelectedIndex: one combo on the Main form, so the last filter stays between openings (0 when
 * first filled, Main.Part4.cs:1881).
 */
let comboIndex: HistoryFilter = HistoryFilter.All;

/**
 * Port of the method_528 switch (Main.Part4.cs:1884-1904): the filter the panel opens on, from the combo's current
 * index. "either" (H, btnHistoryMessages_Click) keeps the last filter unless it was Galactic History, then All.
 */
export function resolveHistoryOpenFilter(current: HistoryFilter, mode: HistoryOpenMode): HistoryFilter {
    switch (mode) {
        case 'galactichistory':
            return HistoryFilter.GalacticHistory;
        case 'nonbattle':
            return HistoryFilter.NonBattle;
        case 'all':
            return HistoryFilter.All;
        case 'either':
            return current === HistoryFilter.GalacticHistory ? HistoryFilter.All : current;
    }
}

/** The combo's index as the next opening sees it (tests). */
export function historyComboIndex(): HistoryFilter {
    return comboIndex;
}

/** Test hook: set the combo's index. */
export function setHistoryComboIndex(f: HistoryFilter): void {
    comboIndex = f;
}

interface OpenState {
    close: () => void;
}

let open: OpenState | null = null;

/** Open the Galactic History screen, or close it when open (btnGalacticHistory_Click). No-op without a DOM. */
export function toggleGalacticHistory(opts: GalacticHistoryOptions): void {
    if (open) open.close();
    else if (typeof document !== 'undefined') open = createGalacticHistory(opts);
}

/** Close the screen (no-op when closed). */
export function closeGalacticHistory(): void {
    open?.close();
}

export function isGalacticHistoryOpen(): boolean {
    return open !== null;
}

// --- Layout (Main.Part4.cs:1856 method_528: pnlMessageHistory 965 × 580, body-relative positions) ---------------------
const WIN = { w: 965, h: 580 };
const FILTER = { x: 10, y: 9, w: 310, h: 21 }; // cmbMessageHistoryFilter
const LIST = { x: 10, y: 35, w: 310, h: 475 }; // ctlMessageHistoryMessages (Icon 35 | Title 195 | StarDate 80)
const HEADING = { x: 330, y: 10, w: 610 }; // lblMessageHistoryHeading: font_2, color_1
const TEXT = { x: 330, y: 35, w: 350, h: 475 }; // txtMessageHistoryText: font_6, (48, 48, 64) / (170, 170, 170)
const MAP = { x: 690, y: 35, size: 250 }; // gmapMessageHistory
const GOTO = { x: 690, y: 295, w: 250, h: 25 }; // btnMessageHistoryGoto
/** Our tab strip (History | Chronicle | Ask | Orders | Battle Reports) above the original layout: 26 px + 5 px gap. */
const TABS_H = 31;
/** color_1 (Main.Part13.cs:157). */
const HEADING_COLOR = 'rgb(120, 120, 120)';

/** GalaxyMap.cs SetPosition + method_6: a world point in the `mapPx`-wide map (trunc(x / scale) + 1); none for (0, 0). */
export function historyMapPoint(galaxySizeX: number, mapPx: number, loc: { x: number; y: number } | null): { x: number; y: number } | null {
    if (loc === null || !(loc.x > 0 && loc.y > 0)) return null;
    const s = galaxySizeX / mapPx;
    return { x: Math.trunc(loc.x / s) + 1, y: Math.trunc(loc.y / s) + 1 };
}

/** gmapMessageHistory (GalaxyMap.cs method_6, ShowEmpireTerritory = false): backdrop, nebulae, sector grid, the system
 *  stars and the pen_2 crosshair on the selected message's location. */
function drawHistoryMap(canvas: HTMLCanvasElement, galaxy: Galaxy, scale: number, point: { x: number; y: number } | null, isClosed: () => boolean): void {
    const W = MAP.size;
    const px = Math.max(1, Math.round(W * scale * (window.devicePixelRatio || 1)));
    if (canvas.width !== px) {
        canvas.width = px;
        canvas.height = px;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const k = px / W;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const s = galaxyMapScale(galaxy, W);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, W);
    drawGalaxyMapLayers(ctx, galaxy, s, 0, 0, { onChange: () => { if (!isClosed() && canvas.isConnected) drawHistoryMap(canvas, galaxy, scale, point, isClosed); } });
    const sec = galaxy.sectorSize / s;
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= galaxy.sectorWidth; i++) {
        const x = Math.trunc(i * sec) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, Math.min(W, galaxy.sectorHeight * sec));
    }
    for (let j = 0; j <= galaxy.sectorHeight; j++) {
        const y = Math.trunc(j * sec) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(Math.min(W, galaxy.sectorWidth * sec), y);
    }
    ctx.stroke();
    const dot = starDotSizes(W, false).normal;
    for (const sys of galaxy.systems) {
        const c = starBrushColor(sys.systemStar);
        if (c === null) continue;
        ctx.fillStyle = c;
        ctx.fillRect(sys.systemStar.xpos / s - dot / 2, sys.systemStar.ypos / s - dot / 2, dot, dot);
    }
    if (point !== null) {
        ctx.strokeStyle = CROSSHAIR_COLOR;
        ctx.beginPath();
        ctx.moveTo(point.x + 0.5, 0);
        ctx.lineTo(point.x + 0.5, W);
        ctx.moveTo(0, point.y + 0.5);
        ctx.lineTo(W, point.y + 0.5);
        ctx.stroke();
    }
}

/** A read-only multiline TextBox (txtMessageHistoryText: FixedSingle, vertical scroll bar). */
function readOnlyText(x: number, y: number, w: number, h: number, extra = ''): HTMLDivElement {
    const t = owEl('div', `gh-textbox ow-scroll${extra ? ` ${extra}` : ''}`);
    return place(t, x, y, w, h);
}

/** The heading label (lblMessageHistoryHeading). */
function headingLabel(x: number, y: number, w: number): HTMLDivElement {
    const t = owText('', { size: FONT.header, bold: true, color: HEADING_COLOR, shadow: false, className: 'gh-heading' });
    return place(t, x, y, w);
}

function createGalacticHistory(opts: GalacticHistoryOptions): OpenState {
    const { empire, onGoTo } = opts;
    const galaxy = empire.galaxy;
    // 19p: with the event log on, the list reads the log (category filter + importance sort).
    const logMode = galacticHistoryUsesEventLog(galaxy);
    comboIndex = opts.filter ?? resolveHistoryOpenFilter(comboIndex, opts.mode ?? 'galactichistory');
    let filter = comboIndex;
    let category: HistoryCategoryFilter = 'all';
    let logSort: HistoryLogSort = 'date';
    /** The selected row's key: an EmpireMessage (faithful list) or an EventLogEntry (log list). */
    let selected: unknown = null;
    let rows: ViewRow[] = [];
    let historyKey = '';
    let closed = false;
    let timer = 0;

    interface ViewRow {
        key: unknown;
        title: string;
        date: string;
        starDate: number;
        icon: HistoryIcon | null;
        heading: string;
        body: string;
        loc: { x: number; y: number } | null;
    }

    // 19s-1: History | Chronicle tabs (only with the chronicle on); 19s-4: Ask | Orders (flag llmArchivist);
    // [improvements] Battle Reports. One tab: the original window as it is.
    const tabList = galacticHistoryTabs(galaxy);
    const oy = tabList.length > 1 ? TABS_H : 0;
    const headerTitle = (): string => (logMode ? text('Galactic History') : historyHeaderTitle(filter));
    const headerIcon = (): string => chromeImageUrl(logMode || filter === HistoryFilter.GalacticHistory ? 'galacticHistory.png' : 'messages.png');
    const win: OriginalWindow = openOriginalWindow({
        id: 'galacticHistory',
        title: headerTitle(),
        iconUrl: headerIcon(),
        width: WIN.w,
        height: WIN.h + oy,
        onClose: () => {
            closed = true;
            window.clearInterval(timer);
            if (open !== null && open.close === close) open = null;
        },
        onResize: () => {
            drawMap();
            drawBattleMap();
        },
    });
    // Hooks kept from the earlier DOM (scripts / tests find the screen by them).
    win.frame.classList.add('galactic-history-window');
    win.frame.querySelector('.ow-close')?.classList.add('galactic-history-close');
    const body = win.body;
    const close = (): void => win.close();

    const page = (): HTMLDivElement => {
        const p = place(owEl('div', 'gh-page'), 0, oy, win.bodySize.w, win.bodySize.h - oy);
        body.appendChild(p);
        return p;
    };
    const pageHistory = page();
    const pageChronicle = page();
    const pageAsk = page();
    const pageOrders = page();
    const pageBattles = page();
    const pages: Record<GalacticHistoryTab, HTMLDivElement> = { history: pageHistory, chronicle: pageChronicle, ask: pageAsk, orders: pageOrders, battles: pageBattles };

    let tab: GalacticHistoryTab = 'history';
    if (tabList.length > 1) {
        const labels: Record<GalacticHistoryTab, string> = {
            history: tryGetText('Chronicle Tab History') ?? 'History',
            chronicle: tryGetText('Chronicle Tab Chronicle') ?? 'Chronicle',
            ask: tryGetText('Chronicle Tab Ask') ?? 'Ask',
            orders: tryGetText('Chronicle Tab Orders') ?? 'Orders',
            battles: tryGetText('Battle Reports Tab') ?? 'Battle Reports',
        };
        const strip = tabStrip(tabList.map((t) => ({ id: t, label: labels[t] })), tab, (id) => setTab(id as GalacticHistoryTab));
        tabList.forEach((t, i) => {
            const b = strip.children[i] as HTMLElement;
            b.classList.add('galactic-history-tab');
            if (t === 'battles') {
                b.classList.add('galactic-history-tab-improvement');
                b.title = `${IMPROVEMENTS_TITLE}: Battle reports (inspired by Distant Worlds 2)`;
            }
        });
        body.appendChild(place(strip, 10, 4, win.bodySize.w - 20));
    }

    // ---- History page (the original pnlMessageHistory) ----
    const filterSelect = logMode
        ? dropDown(historyCategoryOptions().map((c) => ({ value: c.value, label: c.label })), category, (v) => {
              category = v as HistoryCategoryFilter;
              selected = null;
              rebind();
          })
        : dropDown(HISTORY_FILTER_LABELS.map((label, i) => ({ value: String(i), label: text(label) })), String(filter), (v) => {
              filter = comboIndex = Number(v) as HistoryFilter;
              selected = null;
              rebind();
          });
    filterSelect.classList.add('galactic-history-filter');
    if (logMode) {
        // 19p: the category filter and the importance sort share the combo's row.
        pageHistory.appendChild(place(filterSelect, FILTER.x, FILTER.y, 200, FILTER.h));
        const sortSelect = dropDown(
            [
                { value: 'date', label: tryGetText('EventLog Sort Date') ?? 'Sort by Date' },
                { value: 'importance', label: tryGetText('EventLog Sort Importance') ?? 'Sort by Importance' },
            ],
            logSort,
            (v) => {
                logSort = v as HistoryLogSort;
                rebind();
            },
        );
        sortSelect.classList.add('galactic-history-filter');
        pageHistory.appendChild(place(sortSelect, FILTER.x + 205, FILTER.y, FILTER.w - 205, FILTER.h));
    } else pageHistory.appendChild(place(filterSelect, FILTER.x, FILTER.y, FILTER.w, FILTER.h));

    // EmpireMessageListView: Icon (NotSortable) | Subject | Star Date (SortMode.Automatic; the log list keeps its order).
    const flagUrls = new Map<Empire, Promise<string | null>>();
    const flagUrl = (e: Empire): Promise<string | null> => {
        let p = flagUrls.get(e);
        if (p === undefined) {
            p = empireFlagUrl(galaxy, e).catch(() => null);
            flagUrls.set(e, p);
        }
        return p;
    };
    const renderIcon = (icon: HistoryIcon | null, cell: HTMLDivElement): void => {
        if (icon === null) return;
        const img = owEl('img', 'gh-icon');
        img.alt = '';
        img.draggable = false;
        if (icon.kind === 'image') img.src = icon.url;
        else {
            img.title = icon.empire.name;
            void flagUrl(icon.empire).then((u) => {
                if (u !== null) img.src = u;
                else {
                    const sw = owEl('span', 'gh-swatch');
                    sw.style.background = rgbCss(icon.empire.mainColor);
                    sw.title = icon.empire.name;
                    img.replaceWith(sw);
                }
            });
        }
        cell.appendChild(img);
    };
    const columns: GridColumn<ViewRow>[] = [
        { id: 'icon', header: '', width: 35, align: 'center', render: (r, c) => renderIcon(r.icon, c) },
        { id: 'title', header: text('Subject'), fill: 1, ...(logMode ? {} : { sort: (r: ViewRow) => r.title }), render: (r, c) => void (c.textContent = r.title) },
        { id: 'starDate', header: text('Star Date'), width: 80, ...(logMode ? {} : { sort: (r: ViewRow) => r.starDate }), render: (r, c) => void (c.textContent = r.date) },
    ];
    const grid = new OwGrid<ViewRow>({
        columns,
        key: (r) => r.key,
        rowHeight: 20,
        empty: 'No messages',
        onSelect: (r) => {
            selected = r.key;
            showSelected();
        },
    });
    grid.el.classList.add('gh-grid');
    pageHistory.appendChild(place(grid.el, LIST.x, LIST.y, LIST.w, LIST.h));
    const msgHeading = headingLabel(HEADING.x, HEADING.y, HEADING.w);
    const msgText = readOnlyText(TEXT.x, TEXT.y, TEXT.w, TEXT.h);
    pageHistory.append(msgHeading, msgText);
    const mapBox = place(owEl('div', 'gh-map'), MAP.x, MAP.y, MAP.size, MAP.size);
    const mapCanvas = owEl('canvas', 'gh-map-canvas');
    mapBox.appendChild(mapCanvas);
    pageHistory.appendChild(mapBox);
    const gotoBtn = glassButton(text('Go to Location'), {
        className: 'galactic-history-goto',
        disabled: true,
        onClick: () => {
            const row = selectedRow();
            if (row === null || row.loc === null) return;
            onGoTo(row.loc.x, row.loc.y);
            close();
        },
    });
    pageHistory.appendChild(place(gotoBtn, GOTO.x, GOTO.y, GOTO.w, GOTO.h));

    let mapPoint: { x: number; y: number } | null = null;
    let mapDrawn = false;
    function drawMap(): void {
        if (!closed && tab === 'history') drawHistoryMap(mapCanvas, galaxy, win.scale, mapPoint, () => closed);
    }

    function selectedRow(): ViewRow | null {
        return rows.find((r) => r.key === selected) ?? null;
    }

    // Port of Main.Part4.cs:1982 method_531: heading, text, map position and Go To for the selected message.
    function showSelected(): void {
        const row = selectedRow();
        setText(msgHeading, row?.heading ?? '');
        if (msgText.textContent !== (row?.body ?? '')) {
            msgText.textContent = row?.body ?? '';
            msgText.scrollTop = 0;
        }
        gotoBtn.disabled = row === null || row.loc === null;
        const p = historyMapPoint(Math.max(galaxy.sizeX, galaxy.sizeY), MAP.size, row?.loc ?? null);
        if (p?.x !== mapPoint?.x || p?.y !== mapPoint?.y || !mapDrawn) {
            mapPoint = p;
            mapDrawn = true;
            drawMap();
        }
    }

    function buildRows(): ViewRow[] {
        if (logMode) {
            return eventLogHistoryRows(galaxy, empire, category, logSort).map((r) => ({
                key: r.entry,
                title: r.importance > 0 ? `${'!'.repeat(r.importance)} ${r.title}` : r.title,
                date: r.date,
                starDate: r.starDate,
                icon: r.icon,
                heading: `${r.categoryLabel}: ${r.title}`,
                body: r.text,
                loc: r.location,
            }));
        }
        // The list as the trim leaves it: the command lands at the next boundary (in worker mode a round trip later).
        const history = trimmedHistoryView(empire);
        return galacticHistoryRows(empire, filter, history).map((r) => ({
            key: r.message,
            title: r.title,
            date: r.date,
            starDate: r.starDate,
            icon: r.icon,
            heading: r.title,
            body: resolveGameText(r.message.description),
            loc: messageLocation(r.message),
        }));
    }

    // method_542: RemoveOldHistoryMessages (Empire.cs:4708), then rebind. Keeps the selection when still listed,
    // else selects the first row (the grid's default current row).
    function rebind(): void {
        // The command only when there is something to trim (RemoveOldHistoryMessages is a no-op otherwise).
        if (!logMode && empireMessageHistory(empire).length > empire.maximumHistoryMessages) trimMessageHistory(galaxy, empire);
        rows = buildRows();
        win.setTitle(headerTitle());
        win.setIcon(headerIcon());
        grid.setRows(rows);
        if (selected === null || !rows.some((r) => r.key === selected)) selected = grid.displayed[0]?.key ?? null;
        grid.setSelection(selected === null ? [] : [selected]);
        showSelected();
    }

    function currentHistoryKey(): string {
        if (logMode) {
            const entries = eventLogEntries(galaxy);
            return `${entries.length}:${entries.length > 0 ? entries[entries.length - 1].id : 0}`;
        }
        const h = empireMessageHistory(empire);
        return `${h.length}:${h.length > 0 ? h[h.length - 1]?.starDate : 0}`;
    }

    // ---- 19s-1 Chronicle page: years | the year's text + Export Markdown ----
    let chronYear: number | null = null;
    let chronKey = '';
    const chronGrid = new OwGrid<ChronicleRow>({
        columns: [
            { id: 'title', header: tryGetText('Chronicle Tab Chronicle') ?? 'Chronicle', fill: 1, render: (r, c) => void (c.textContent = r.title) },
            { id: 'year', header: text('Star Date'), width: 80, align: 'right', render: (r, c) => void (c.textContent = String(r.year)) },
        ],
        key: (r) => `${r.year}:${r.source}`,
        rowHeight: 20,
        empty: tryGetText('Chronicle Empty') ?? 'No year has ended yet',
        rowClass: (r) => (r.source === 'pending' ? 'gh-pending' : ''),
        onSelect: (r) => {
            if (r.source !== 'pending') chronYear = r.year;
            renderChronicle(true);
        },
    });
    pageChronicle.appendChild(place(chronGrid.el, LIST.x, FILTER.y, LIST.w, LIST.y + LIST.h - FILTER.y - 35));
    const exportBtn = glassButton(tryGetText('Chronicle Export') ?? 'Export Markdown', {
        className: 'galactic-history-goto',
        onClick: () => {
            const blob = new Blob([chronicleMarkdown(galaxy, empire)], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = chronicleFileName(empire);
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
    });
    pageChronicle.appendChild(place(exportBtn, LIST.x, LIST.y + LIST.h - 25, LIST.w, 25));
    const chronHeading = headingLabel(HEADING.x, HEADING.y, HEADING.w);
    const chronText = readOnlyText(TEXT.x, TEXT.y, MAP.x + MAP.size - TEXT.x, TEXT.h, 'gh-prewrap');
    pageChronicle.append(chronHeading, chronText);

    function chronicleKey(): string {
        const ys = chronicleYears(galaxy, empire);
        return ys.map((c) => `${c.year}:${c.source}:${c.written}`).join(',') + `|${dueChronicleYear(galaxy, empire) ?? ''}`;
    }
    function renderChronicle(selectionOnly = false): void {
        const crow = chronicleRows(galaxy, empire);
        if (chronYear === null || !crow.some((r) => r.year === chronYear)) chronYear = crow.find((r) => r.source !== 'pending')?.year ?? crow[0]?.year ?? null;
        if (!selectionOnly) {
            chronKey = chronicleKey();
            chronGrid.setRows(crow);
        }
        const cur = crow.find((r) => r.year === chronYear && r.source !== 'pending') ?? null;
        chronGrid.setSelection(cur !== null ? [`${cur.year}:${cur.source}`] : []);
        setText(chronHeading, cur !== null ? `${cur.year} — ${cur.title}` : '');
        let t = cur !== null ? cur.text : '';
        if (cur !== null && cur.source === 'fallback') t += `\n\n${tryGetText('Chronicle Fallback Note') ?? '(A plain record: no chronicler model answered.)'}`;
        setText(chronText, t);
        exportBtn.disabled = !crow.some((r) => r.source !== 'pending');
    }

    // ---- 19s-4 Ask page: question box | answer + cited records ----
    const askInput = textBox('', tryGetText('Chronicle Ask Placeholder') ?? 'Ask the archive', () => {});
    askInput.classList.add('galactic-history-ask-input');
    askInput.maxLength = 400;
    pageAsk.appendChild(place(askInput, 10, FILTER.y, 820, 25));
    const askBtn = glassButton(tryGetText('Chronicle Ask Button') ?? 'Ask', { className: 'galactic-history-goto', onClick: () => submitAsk() });
    pageAsk.appendChild(place(askBtn, 840, FILTER.y, 100, 25));
    const askAnswer = readOnlyText(10, 44, 930, 290, 'gh-prewrap galactic-history-ask-answer');
    pageAsk.appendChild(askAnswer);
    const askCitedHeading = headingLabel(10, 344, 930);
    const askCited = place(scrollPanel('gh-cited'), 10, 370, 930, 140);
    pageAsk.append(askCitedHeading, askCited);
    askInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitAsk();
        }
    });
    // One question at a time; the answer arrives between frames (the queue's promise) and only reads.
    let asking = false;
    function submitAsk(): void {
        const q = askInput.value.trim();
        if (asking || q === '') return;
        asking = true;
        askBtn.disabled = true;
        askAnswer.textContent = tryGetText('Chronicle Ask Waiting') ?? 'The archivist is searching the records…';
        askCitedHeading.textContent = '';
        askCited.replaceChildren();
        void askArchivist(galaxy, empire, currentLlmLayer()?.queue ?? null, q).then((a) => {
            asking = false;
            askBtn.disabled = false;
            if (closed) return;
            askAnswer.textContent = a.answer;
            askCited.replaceChildren();
            askCitedHeading.textContent = a.citations.length > 0 ? (tryGetText('Chronicle Ask Cited') ?? 'Cited records') : '';
            for (const c of a.citations) askCited.appendChild(owEl('div', 'gh-cited-line galactic-history-ask-line', archiveLineText(c)));
        });
    }

    // ---- 19s-4 Orders page: order box | the mapped order + Confirm / Cancel, or the clerk's question ----
    const ordInput = textBox('', tryGetText('Chronicle Orders Placeholder') ?? 'Give an order', () => {});
    ordInput.classList.add('galactic-history-ask-input');
    ordInput.maxLength = 400;
    pageOrders.appendChild(place(ordInput, 10, FILTER.y, 820, 25));
    const ordBtn = glassButton(tryGetText('Chronicle Orders Button') ?? 'Interpret', { className: 'galactic-history-goto', onClick: () => submitOrder() });
    pageOrders.appendChild(place(ordBtn, 840, FILTER.y, 100, 25));
    const ordLine = readOnlyText(10, 44, 930, 120, 'gh-prewrap galactic-history-ask-answer');
    pageOrders.appendChild(ordLine);
    const ordConfirm = glassButton(tryGetText('Chronicle Orders Confirm') ?? 'Confirm', {
        className: 'galactic-history-goto',
        onClick: () => {
            const order = pendingOrder;
            if (order === null) return;
            showOrder(tryGetText('Chronicle Orders Issued') ?? 'Order issued.', null);
            confirmOrder(galaxy, empire, order, (r) => {
                if (!closed) ordLine.textContent = `${r.ok ? '✓' : '✗'} ${r.message}`;
            });
            ordInput.value = '';
        },
    });
    const ordCancel = glassButton(tryGetText('Chronicle Orders Cancel') ?? 'Cancel', { className: 'galactic-history-goto', onClick: () => showOrder('', null) });
    pageOrders.append(place(ordConfirm, 10, 174, 150, 25), place(ordCancel, 170, 174, 150, 25));
    ordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitOrder();
        }
    });
    // Interpret → the confirmation line; only Confirm issues the command (through the command queue).
    let pendingOrder: PendingOrder | null = null;
    let interpreting = false;
    function showOrder(line: string, order: PendingOrder | null): void {
        pendingOrder = order;
        ordLine.textContent = order !== null ? `${line} — confirm?` : line;
        ordConfirm.style.display = ordCancel.style.display = order !== null ? '' : 'none';
    }
    showOrder('', null);
    function submitOrder(): void {
        const t = ordInput.value.trim();
        if (interpreting || t === '') return;
        interpreting = true;
        ordBtn.disabled = true;
        showOrder(tryGetText('Chronicle Orders Waiting') ?? 'The order clerk is reading your order…', null);
        void interpretOrder(galaxy, empire, currentLlmLayer()?.queue ?? null, advisorSelectionFromHud(), t).then((r) => {
            interpreting = false;
            ordBtn.disabled = false;
            if (closed) return;
            if (r.status === 'confirm') showOrder(r.line, r.order);
            else showOrder(r.text, null);
        });
    }

    // ---- [improvements] Battle Reports page: the reports | the selected one's summary, map, Open Report / Go To ----
    type BattleRow = ReturnType<typeof battleReportRows>[number];
    let batSelected: number | null = null;
    let batKey = '';
    let batWithSkirmishes = false;
    const batFilter = dropDown(
        [
            { value: 'battles', label: 'Battles' },
            { value: 'all', label: 'Battles and skirmishes' },
        ],
        'battles',
        (v) => {
            batWithSkirmishes = v === 'all';
            renderBattles();
        },
    );
    batFilter.classList.add('galactic-history-filter');
    pageBattles.appendChild(place(batFilter, FILTER.x, FILTER.y, FILTER.w, FILTER.h));
    const batGrid = new OwGrid<BattleRow>({
        columns: [
            {
                id: 'result',
                header: '',
                width: 35,
                align: 'center',
                render: (r, c) => {
                    const sw = owEl('span', 'gh-swatch');
                    sw.style.background = r.color;
                    sw.title = RESULT_LABELS[r.report.result];
                    c.appendChild(sw);
                },
            },
            { id: 'title', header: text('Subject'), fill: 1, sort: (r) => r.title, render: (r, c) => void (c.textContent = r.title) },
            { id: 'date', header: text('Star Date'), width: 80, sort: (r) => r.report.endStarDate, render: (r, c) => void (c.textContent = r.date) },
        ],
        key: (r) => r.report.id,
        rowHeight: 20,
        empty: 'No battles yet',
        rowClass: (r) => (r.report.minor ? 'galactic-history-row-minor gh-minor' : ''),
        onSelect: (r) => {
            batSelected = r.report.id;
            showBattle();
        },
        onDoubleClick: (r) => openBattleReport(r.report),
    });
    batGrid.el.classList.add('gh-grid');
    pageBattles.appendChild(place(batGrid.el, LIST.x, LIST.y, LIST.w, LIST.h));
    const batHeading = headingLabel(HEADING.x, HEADING.y, HEADING.w);
    const batText = readOnlyText(TEXT.x, TEXT.y, TEXT.w, TEXT.h, 'gh-prewrap');
    pageBattles.append(batHeading, batText);
    const batMapBox = place(owEl('div', 'gh-map'), MAP.x, MAP.y, MAP.size, MAP.size);
    const batCanvas = owEl('canvas', 'gh-map-canvas');
    batMapBox.appendChild(batCanvas);
    pageBattles.appendChild(batMapBox);
    const batOpen = glassButton('Open Report', {
        className: 'galactic-history-goto',
        onClick: () => {
            const cur = listBattleReports(galaxy, true).find((r) => r.id === batSelected);
            if (cur !== undefined) openBattleReport(cur);
        },
    });
    const batGoto = glassButton(text('Go to Location'), {
        className: 'galactic-history-goto',
        onClick: () => {
            const cur = listBattleReports(galaxy, true).find((r) => r.id === batSelected);
            if (cur === undefined) return;
            onGoTo(cur.x, cur.y);
            close();
        },
    });
    pageBattles.append(place(batOpen, GOTO.x, GOTO.y, GOTO.w, GOTO.h), place(batGoto, GOTO.x, GOTO.y + 30, GOTO.w, GOTO.h));
    pageBattles.appendChild(
        place(owText(`${IMPROVEMENTS_TITLE} — inspired by Distant Worlds 2`, { size: FONT.tiny, color: HEADING_COLOR, shadow: false, wrapWidth: MAP.size, className: 'galactic-history-improvement-note' }), GOTO.x, GOTO.y + 64),
    );

    let batPoint: { x: number; y: number } | null = null;
    function drawBattleMap(): void {
        if (!closed && tab === 'battles') drawHistoryMap(batCanvas, galaxy, win.scale, batPoint, () => closed);
    }
    function battlesKey(): string {
        return listBattleReports(galaxy, true).map((r) => r.id).join(',') + `|${batWithSkirmishes ? 'all' : 'battles'}`;
    }
    function showBattle(): void {
        const cur = listBattleReports(galaxy, true).find((r) => r.id === batSelected) ?? null;
        setText(batHeading, cur !== null ? battleListTitle(cur) : '');
        setText(batText, cur !== null ? battleReportSummary(cur) : '');
        batOpen.disabled = cur === null;
        batGoto.disabled = cur === null;
        batPoint = historyMapPoint(Math.max(galaxy.sizeX, galaxy.sizeY), MAP.size, cur !== null ? { x: cur.x, y: cur.y } : null);
        drawBattleMap();
    }
    function renderBattles(): void {
        batKey = battlesKey();
        const brows = battleReportRows(galaxy, batWithSkirmishes);
        batGrid.setRows(brows);
        if (batSelected === null || !brows.some((r) => r.report.id === batSelected)) batSelected = brows[0]?.report.id ?? null;
        batGrid.setSelection(batSelected === null ? [] : [batSelected]);
        showBattle();
    }

    function setTab(t: GalacticHistoryTab): void {
        tab = t;
        for (const k of Object.keys(pages) as GalacticHistoryTab[]) pages[k].style.display = t === k ? '' : 'none';
        if (t === 'history') drawMap();
        if (t === 'battles') renderBattles();
        if (t === 'chronicle') renderChronicle();
        if (t === 'ask') askInput.focus();
        if (t === 'orders') ordInput.focus();
    }

    historyKey = currentHistoryKey();
    setTab('history');
    rebind();
    // New history entries while open: rebind only when the history changed (no per-tick DOM rebuild).
    timer = window.setInterval(() => {
        if (tab === 'chronicle') {
            if (chronicleKey() !== chronKey) renderChronicle();
            return;
        }
        if (tab === 'battles') {
            if (battlesKey() !== batKey) renderBattles();
            return;
        }
        const k = currentHistoryKey();
        if (k === historyKey) return;
        historyKey = k;
        rebind();
    }, 1000);

    return { close };
}
