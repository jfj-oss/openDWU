// Galactic History screen: the original's pnlMessageHistory opened by btnGalacticHistory (Main.Part3.cs:46
// btnGalacticHistory_Click → Main.Part4.cs:1856 method_528("galactichistory")) — the player's saved
// Empire.MessageHistory in an EmpireMessageListView (Icon | Subject | Star Date), a filter combo
// (All / Non-Battle / Galactic History), the selected message's title + text, and Go To.
// TODO(port): the small galaxy map beside the text (gmapMessageHistory, Main.Part4.cs:1921-1923 / 1996) — Main.Part4.cs:method_531

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
import { rgbCss } from '../hud';
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

export type GalacticHistoryTab = 'history' | 'chronicle' | 'ask' | 'orders';

/** The screen's tabs: History always; Chronicle (19s-1), Ask and Orders (19s-4, flag llmArchivist) when on. */
export function galacticHistoryTabs(galaxy: Galaxy | null | undefined): GalacticHistoryTab[] {
    const tabs: GalacticHistoryTab[] = ['history'];
    if (chronicleOn(galaxy)) tabs.push('chronicle');
    if (archiveQuestionsOn(galaxy)) tabs.push('ask');
    if (archivistOn(galaxy)) tabs.push('orders');
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

function el(tag: string, className: string, content?: string): HTMLElement {
    const e = document.createElement(tag);
    e.className = className;
    if (content !== undefined) e.textContent = content;
    return e;
}

function createGalacticHistory(opts: GalacticHistoryOptions): OpenState {
    const { empire, onGoTo } = opts;
    // 19p: with the event log on, the list reads the log (category filter + importance sort).
    const logMode = galacticHistoryUsesEventLog(empire.galaxy);
    comboIndex = opts.filter ?? resolveHistoryOpenFilter(comboIndex, opts.mode ?? 'galactichistory');
    let filter = comboIndex;
    let category: HistoryCategoryFilter = 'all';
    let logSort: HistoryLogSort = 'date';
    let sort: HistorySort | null = null;
    /** The selected row's key: an EmpireMessage (faithful list) or an EventLogEntry (log list). */
    let selected: unknown = null;
    let rows: ViewRow[] = [];
    let historyKey = '';

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

    const root = el('div', 'galactic-history-wrap');
    const win = el('div', 'galactic-history-window');
    const titlebar = el('div', 'galactic-history-titlebar');
    const heading = el('div', 'galactic-history-heading');
    const closeBtn = el('button', 'galactic-history-close', '✕') as HTMLButtonElement;
    closeBtn.type = 'button';
    closeBtn.title = 'Close';
    // 19s-1: History | Chronicle tabs (only with the chronicle on); 19s-4: Ask | Orders (flag llmArchivist).
    const tabList = galacticHistoryTabs(empire.galaxy);
    const tabs = el('div', 'galactic-history-tabs');
    const tabButton = (tag: string, fallback: string): HTMLButtonElement => {
        const b = el('button', 'galactic-history-tab', tryGetText(tag) ?? fallback) as HTMLButtonElement;
        b.type = 'button';
        return b;
    };
    const tabHistory = tabButton('Chronicle Tab History', 'History');
    tabHistory.classList.add('galactic-history-tab-active');
    const tabChronicle = tabButton('Chronicle Tab Chronicle', 'Chronicle');
    const tabAsk = tabButton('Chronicle Tab Ask', 'Ask');
    const tabOrders = tabButton('Chronicle Tab Orders', 'Orders');
    const tabButtons: Record<GalacticHistoryTab, HTMLButtonElement> = { history: tabHistory, chronicle: tabChronicle, ask: tabAsk, orders: tabOrders };
    for (const t of tabList) tabs.appendChild(tabButtons[t]);
    if (tabList.length > 1) titlebar.append(heading, tabs, closeBtn);
    else titlebar.append(heading, closeBtn);

    const body = el('div', 'galactic-history-body');
    const left = el('div', 'galactic-history-left');
    const select = document.createElement('select');
    select.className = 'galactic-history-filter';
    if (logMode) {
        for (const c of historyCategoryOptions()) {
            const o = document.createElement('option');
            o.value = c.value;
            o.textContent = c.label;
            select.appendChild(o);
        }
    } else {
        HISTORY_FILTER_LABELS.forEach((label, i) => {
            const o = document.createElement('option');
            o.value = String(i);
            o.textContent = text(label);
            select.appendChild(o);
        });
    }
    const sortSelect = document.createElement('select');
    sortSelect.className = 'galactic-history-filter';
    for (const [v, tag, fallback] of [['date', 'EventLog Sort Date', 'Sort by Date'], ['importance', 'EventLog Sort Importance', 'Sort by Importance']] as const) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = tryGetText(tag) ?? fallback;
        sortSelect.appendChild(o);
    }
    const header = el('div', 'galactic-history-header');
    const hIcon = el('span', 'galactic-history-header-cell');
    const hTitle = el('button', 'galactic-history-header-cell galactic-history-sortable') as HTMLButtonElement;
    const hDate = el('button', 'galactic-history-header-cell galactic-history-sortable galactic-history-date') as HTMLButtonElement;
    hTitle.type = 'button';
    hDate.type = 'button';
    header.append(hIcon, hTitle, hDate);
    const list = el('div', 'galactic-history-list');
    if (logMode) left.append(select, sortSelect, header, list);
    else left.append(select, header, list);

    const right = el('div', 'galactic-history-right');
    const msgHeading = el('div', 'galactic-history-msg-heading');
    const msgText = el('div', 'galactic-history-msg-text');
    const gotoBtn = el('button', 'galactic-history-goto', 'Go To') as HTMLButtonElement;
    gotoBtn.type = 'button';
    right.append(msgHeading, msgText, gotoBtn);
    body.append(left, right);
    // 19s-1 Chronicle view: years | the year's text + Export Markdown.
    const chronBody = el('div', 'galactic-history-body');
    const chronLeft = el('div', 'galactic-history-left');
    const chronList = el('div', 'galactic-history-list');
    const exportBtn = el('button', 'galactic-history-goto', tryGetText('Chronicle Export') ?? 'Export Markdown') as HTMLButtonElement;
    exportBtn.type = 'button';
    chronLeft.append(chronList, exportBtn);
    const chronRight = el('div', 'galactic-history-right');
    const chronHeading = el('div', 'galactic-history-msg-heading');
    const chronText = el('div', 'galactic-history-msg-text galactic-history-chronicle-text');
    chronRight.append(chronHeading, chronText);
    chronBody.append(chronLeft, chronRight);
    chronBody.style.display = 'none';
    // 19s-4 Ask view: question box | answer + cited records.
    const askBody = el('div', 'galactic-history-body galactic-history-ask');
    const askForm = el('form', 'galactic-history-ask-form') as HTMLFormElement;
    const askInput = document.createElement('input');
    askInput.type = 'text';
    askInput.className = 'galactic-history-ask-input';
    askInput.maxLength = 400;
    askInput.placeholder = tryGetText('Chronicle Ask Placeholder') ?? 'Ask the archive';
    const askBtn = el('button', 'galactic-history-goto', tryGetText('Chronicle Ask Button') ?? 'Ask') as HTMLButtonElement;
    askBtn.type = 'submit';
    askForm.append(askInput, askBtn);
    const askAnswer = el('div', 'galactic-history-msg-text galactic-history-chronicle-text galactic-history-ask-answer');
    const askCited = el('div', 'galactic-history-ask-cited');
    askBody.append(askForm, askAnswer, askCited);
    askBody.style.display = 'none';
    // 19s-4 Orders view: order box | the mapped order + Confirm / Cancel, or the clerk's question.
    const ordBody = el('div', 'galactic-history-body galactic-history-ask');
    const ordForm = el('form', 'galactic-history-ask-form') as HTMLFormElement;
    const ordInput = document.createElement('input');
    ordInput.type = 'text';
    ordInput.className = 'galactic-history-ask-input';
    ordInput.maxLength = 400;
    ordInput.placeholder = tryGetText('Chronicle Orders Placeholder') ?? 'Give an order';
    const ordBtn = el('button', 'galactic-history-goto', tryGetText('Chronicle Orders Button') ?? 'Interpret') as HTMLButtonElement;
    ordBtn.type = 'submit';
    ordForm.append(ordInput, ordBtn);
    const ordLine = el('div', 'galactic-history-msg-text galactic-history-ask-answer');
    const ordActions = el('div', 'galactic-history-ask-actions');
    const ordConfirm = el('button', 'galactic-history-goto', tryGetText('Chronicle Orders Confirm') ?? 'Confirm') as HTMLButtonElement;
    const ordCancel = el('button', 'galactic-history-goto', tryGetText('Chronicle Orders Cancel') ?? 'Cancel') as HTMLButtonElement;
    ordConfirm.type = 'button';
    ordCancel.type = 'button';
    ordActions.append(ordConfirm, ordCancel);
    ordActions.style.display = 'none';
    ordBody.append(ordForm, ordLine, ordActions);
    ordBody.style.display = 'none';
    win.append(titlebar, body, chronBody, askBody, ordBody);
    root.appendChild(win);
    document.body.appendChild(root);

    function renderHeader(): void {
        const arrow = (c: HistorySortColumn): string => (!logMode && sort?.column === c ? (sort.ascending ? ' ▲' : ' ▼') : '');
        hTitle.textContent = text('Subject') + arrow('title');
        hDate.textContent = text('Star Date') + arrow('starDate');
    }

    function selectedRow(): ViewRow | null {
        return rows.find((r) => r.key === selected) ?? null;
    }

    // Port of Main.Part4.cs:1982 method_531: heading, text and Go To for the selected message.
    function showSelected(): void {
        const row = selectedRow();
        if (row === null) {
            msgHeading.textContent = '';
            msgText.textContent = '';
            gotoBtn.disabled = true;
            return;
        }
        msgHeading.textContent = row.heading;
        msgText.textContent = row.body;
        gotoBtn.disabled = row.loc === null;
    }

    /** The rows in display order (the faithful list applies the column sort; the log list is ordered by its builder). */
    function shownRows(): ViewRow[] {
        if (logMode) return rows;
        const byKey = new Map(rows.map((r) => [r.key, r] as const));
        return sortHistoryRows(
            rows.map((r) => ({ message: r.key as EmpireMessage, title: r.title, starDate: r.starDate, date: r.date, icon: r.icon })),
            sort,
        ).map((r) => byKey.get(r.message)!);
    }

    function renderList(): void {
        heading.textContent = logMode ? text('Galactic History') : historyHeaderTitle(filter);
        renderHeader();
        const shown = shownRows();
        list.replaceChildren();
        if (shown.length === 0) list.appendChild(el('div', 'galactic-history-empty', 'No messages'));
        for (const row of shown) {
            const line = el('div', 'galactic-history-row');
            if (row.key === selected) line.classList.add('galactic-history-row-selected');
            const icon = el('span', 'galactic-history-icon');
            if (row.icon?.kind === 'image') {
                const img = document.createElement('img');
                img.src = row.icon.url;
                img.alt = '';
                img.draggable = false;
                icon.appendChild(img);
            } else if (row.icon?.kind === 'flag') {
                const sw = el('span', 'galactic-history-swatch');
                sw.style.background = rgbCss(row.icon.empire.mainColor);
                sw.title = row.icon.empire.name;
                icon.appendChild(sw);
            }
            line.append(icon, el('span', 'galactic-history-title', row.title), el('span', 'galactic-history-date', row.date));
            line.addEventListener('click', () => {
                selected = row.key;
                for (const r of list.children) r.classList.remove('galactic-history-row-selected');
                line.classList.add('galactic-history-row-selected');
                showSelected();
            });
            list.appendChild(line);
        }
    }

    function buildRows(): ViewRow[] {
        if (logMode) {
            return eventLogHistoryRows(empire.galaxy, empire, category, logSort).map((r) => ({
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
        if (!logMode && empireMessageHistory(empire).length > empire.maximumHistoryMessages) trimMessageHistory(empire.galaxy, empire);
        rows = buildRows();
        if (selected === null || !rows.some((r) => r.key === selected)) selected = shownRows()[0]?.key ?? null;
        renderList();
        showSelected();
    }

    function currentHistoryKey(): string {
        if (logMode) {
            const entries = eventLogEntries(empire.galaxy);
            return `${entries.length}:${entries.length > 0 ? entries[entries.length - 1].id : 0}`;
        }
        const h = empireMessageHistory(empire);
        return `${h.length}:${h.length > 0 ? h[h.length - 1]?.starDate : 0}`;
    }

    select.value = logMode ? category : String(filter);
    select.addEventListener('change', () => {
        if (logMode) category = select.value as HistoryCategoryFilter;
        else filter = comboIndex = Number(select.value) as HistoryFilter;
        selected = null;
        rebind();
    });
    sortSelect.value = logSort;
    sortSelect.addEventListener('change', () => {
        logSort = sortSelect.value as HistoryLogSort;
        rebind();
    });
    hTitle.addEventListener('click', () => {
        if (logMode) return;
        sort = nextHistorySort(sort, 'title');
        renderList();
    });
    hDate.addEventListener('click', () => {
        if (logMode) return;
        sort = nextHistorySort(sort, 'starDate');
        renderList();
    });
    gotoBtn.addEventListener('click', () => {
        const row = selectedRow();
        if (row === null || row.loc === null) return;
        onGoTo(row.loc.x, row.loc.y);
        close();
    });

    // 19s-1 Chronicle tab.
    let tab: GalacticHistoryTab = 'history';
    let chronYear: number | null = null;
    let chronKey = '';
    function chronicleKey(): string {
        const ys = chronicleYears(empire.galaxy, empire);
        return ys.map((c) => `${c.year}:${c.source}:${c.written}`).join(',') + `|${dueChronicleYear(empire.galaxy, empire) ?? ''}`;
    }
    function renderChronicle(): void {
        chronKey = chronicleKey();
        const crow = chronicleRows(empire.galaxy, empire);
        if (chronYear === null || !crow.some((r) => r.year === chronYear)) chronYear = crow.find((r) => r.source !== 'pending')?.year ?? crow[0]?.year ?? null;
        chronList.replaceChildren();
        if (crow.length === 0) chronList.appendChild(el('div', 'galactic-history-empty', tryGetText('Chronicle Empty') ?? 'No year has ended yet'));
        for (const r of crow) {
            const line = el('div', 'galactic-history-row');
            if (r.year === chronYear && r.source !== 'pending') line.classList.add('galactic-history-row-selected');
            line.append(el('span', 'galactic-history-icon'), el('span', 'galactic-history-title', r.title), el('span', 'galactic-history-date', String(r.year)));
            if (r.source !== 'pending') {
                line.addEventListener('click', () => {
                    chronYear = r.year;
                    renderChronicle();
                });
            }
            chronList.appendChild(line);
        }
        const cur = crow.find((r) => r.year === chronYear && r.source !== 'pending') ?? null;
        chronHeading.textContent = cur !== null ? `${cur.year} — ${cur.title}` : '';
        chronText.textContent = cur !== null ? cur.text : '';
        if (cur !== null && cur.source === 'fallback') chronText.textContent += `\n\n${tryGetText('Chronicle Fallback Note') ?? '(A plain record: no chronicler model answered.)'}`;
        exportBtn.disabled = !crow.some((r) => r.source !== 'pending');
    }
    function setTab(t: GalacticHistoryTab): void {
        tab = t;
        for (const k of Object.keys(tabButtons) as GalacticHistoryTab[]) tabButtons[k].classList.toggle('galactic-history-tab-active', t === k);
        body.style.display = t === 'history' ? '' : 'none';
        chronBody.style.display = t === 'chronicle' ? '' : 'none';
        askBody.style.display = t === 'ask' ? '' : 'none';
        ordBody.style.display = t === 'orders' ? '' : 'none';
        if (t === 'chronicle') renderChronicle();
        if (t === 'ask') askInput.focus();
        if (t === 'orders') ordInput.focus();
    }
    for (const k of Object.keys(tabButtons) as GalacticHistoryTab[]) tabButtons[k].addEventListener('click', () => setTab(k));

    // 19s-4 Ask: one question at a time; the answer arrives between frames (the queue's promise) and only reads.
    let closed = false;
    let asking = false;
    askForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const q = askInput.value.trim();
        if (asking || q === '') return;
        asking = true;
        askBtn.disabled = true;
        askAnswer.textContent = tryGetText('Chronicle Ask Waiting') ?? 'The archivist is searching the records…';
        askCited.replaceChildren();
        void askArchivist(empire.galaxy, empire, currentLlmLayer()?.queue ?? null, q).then((a) => {
            asking = false;
            askBtn.disabled = false;
            if (closed) return;
            askAnswer.textContent = a.answer;
            askCited.replaceChildren();
            if (a.citations.length > 0) {
                askCited.appendChild(el('div', 'galactic-history-msg-heading', tryGetText('Chronicle Ask Cited') ?? 'Cited records'));
                for (const c of a.citations) askCited.appendChild(el('div', 'galactic-history-ask-line', archiveLineText(c)));
            }
        });
    });

    // 19s-4 Orders: interpret → the confirmation line; only Confirm issues the command (through the command queue).
    let pendingOrder: PendingOrder | null = null;
    let interpreting = false;
    function showOrder(text: string, order: PendingOrder | null): void {
        pendingOrder = order;
        ordLine.textContent = order !== null ? `${text} — confirm?` : text;
        ordActions.style.display = order !== null ? '' : 'none';
    }
    ordForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = ordInput.value.trim();
        if (interpreting || text === '') return;
        interpreting = true;
        ordBtn.disabled = true;
        showOrder(tryGetText('Chronicle Orders Waiting') ?? 'The order clerk is reading your order…', null);
        void interpretOrder(empire.galaxy, empire, currentLlmLayer()?.queue ?? null, advisorSelectionFromHud(), text).then((r) => {
            interpreting = false;
            ordBtn.disabled = false;
            if (closed) return;
            if (r.status === 'confirm') showOrder(r.line, r.order);
            else showOrder(r.text, null);
        });
    });
    ordConfirm.addEventListener('click', () => {
        const order = pendingOrder;
        if (order === null) return;
        showOrder(tryGetText('Chronicle Orders Issued') ?? 'Order issued.', null);
        confirmOrder(empire.galaxy, empire, order, (r) => {
            if (!closed) ordLine.textContent = `${r.ok ? '✓' : '✗'} ${r.message}`;
        });
        ordInput.value = '';
    });
    ordCancel.addEventListener('click', () => showOrder('', null));
    exportBtn.addEventListener('click', () => {
        const blob = new Blob([chronicleMarkdown(empire.galaxy, empire)], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = chronicleFileName(empire);
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    historyKey = currentHistoryKey();
    rebind();
    // New history entries while open: rebind only when the history changed (no per-tick DOM rebuild).
    const timer = setInterval(() => {
        if (tab === 'chronicle') {
            if (chronicleKey() !== chronKey) renderChronicle();
            return;
        }
        const k = currentHistoryKey();
        if (k === historyKey) return;
        historyKey = k;
        rebind();
    }, 1000);

    function close(): void {
        closed = true;
        clearInterval(timer);
        document.removeEventListener('keydown', onKeyDown);
        root.remove();
        open = null;
    }

    // Escape closes the panel; stopImmediatePropagation keeps the global game-menu Escape handler from opening too.
    function onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            close();
        }
    }
    document.addEventListener('keydown', onKeyDown);
    closeBtn.addEventListener('click', () => close());

    return { close };
}
