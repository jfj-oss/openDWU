// Galactic History screen: the original's pnlMessageHistory opened by btnGalacticHistory (Main.Part3.cs:46
// btnGalacticHistory_Click → Main.Part4.cs:1856 method_528("galactichistory")) — the player's saved
// Empire.MessageHistory in an EmpireMessageListView (Icon | Subject | Star Date), a filter combo
// (All / Non-Battle / Galactic History), the selected message's title + text, and Go To.
// TODO(port): the small galaxy map beside the text (gmapMessageHistory, Main.Part4.cs:1921-1923 / 1996) — Main.Part4.cs:method_531

import './galacticHistory.css';
import { EmpireMessageType, empireMessageHistory, removeOldHistoryMessages, type EmpireMessage } from '../../sim/messages';
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
export function galacticHistoryRows(player: Empire, filter: HistoryFilter): GalacticHistoryRow[] {
    return filterHistoryMessages(empireMessageHistory(player), filter).map((m) => ({
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
// DOM
// ---------------------------------------------------------------------------

export interface GalacticHistoryOptions {
    empire: Empire;
    /** btnMessageHistoryGoto (Main.Part4.cs:1967): move the view to the point at planet zoom (method_156 + method_4(1.0)). */
    onGoTo: (x: number, y: number) => void;
    /** Initial filter (method_528's argument; default "galactichistory"). */
    filter?: HistoryFilter;
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
    let filter = opts.filter ?? HistoryFilter.GalacticHistory;
    let sort: HistorySort | null = null;
    let selected: EmpireMessage | null = null;
    let rows: GalacticHistoryRow[] = [];
    let historyKey = '';

    const root = el('div', 'galactic-history-wrap');
    const win = el('div', 'galactic-history-window');
    const titlebar = el('div', 'galactic-history-titlebar');
    const heading = el('div', 'galactic-history-heading');
    const closeBtn = el('button', 'galactic-history-close', '✕') as HTMLButtonElement;
    closeBtn.type = 'button';
    closeBtn.title = 'Close';
    titlebar.append(heading, closeBtn);

    const body = el('div', 'galactic-history-body');
    const left = el('div', 'galactic-history-left');
    const select = document.createElement('select');
    select.className = 'galactic-history-filter';
    HISTORY_FILTER_LABELS.forEach((label, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = text(label);
        select.appendChild(o);
    });
    const header = el('div', 'galactic-history-header');
    const hIcon = el('span', 'galactic-history-header-cell');
    const hTitle = el('button', 'galactic-history-header-cell galactic-history-sortable') as HTMLButtonElement;
    const hDate = el('button', 'galactic-history-header-cell galactic-history-sortable galactic-history-date') as HTMLButtonElement;
    hTitle.type = 'button';
    hDate.type = 'button';
    header.append(hIcon, hTitle, hDate);
    const list = el('div', 'galactic-history-list');
    left.append(select, header, list);

    const right = el('div', 'galactic-history-right');
    const msgHeading = el('div', 'galactic-history-msg-heading');
    const msgText = el('div', 'galactic-history-msg-text');
    const gotoBtn = el('button', 'galactic-history-goto', 'Go To') as HTMLButtonElement;
    gotoBtn.type = 'button';
    right.append(msgHeading, msgText, gotoBtn);
    body.append(left, right);
    win.append(titlebar, body);
    root.appendChild(win);
    document.body.appendChild(root);

    function renderHeader(): void {
        const arrow = (c: HistorySortColumn): string => (sort?.column === c ? (sort.ascending ? ' ▲' : ' ▼') : '');
        hTitle.textContent = text('Subject') + arrow('title');
        hDate.textContent = text('Star Date') + arrow('starDate');
    }

    // Port of Main.Part4.cs:1982 method_531: heading, text and Go To for the selected message.
    function showSelected(): void {
        if (selected === null) {
            msgHeading.textContent = '';
            msgText.textContent = '';
            gotoBtn.disabled = true;
            return;
        }
        msgHeading.textContent = messageTitle(selected, empire);
        msgText.textContent = resolveGameText(selected.description);
        gotoBtn.disabled = messageLocation(selected) === null;
    }

    function renderList(): void {
        heading.textContent = historyHeaderTitle(filter);
        renderHeader();
        const shown = sortHistoryRows(rows, sort);
        list.replaceChildren();
        if (shown.length === 0) list.appendChild(el('div', 'galactic-history-empty', 'No messages'));
        for (const row of shown) {
            const line = el('div', 'galactic-history-row');
            if (row.message === selected) line.classList.add('galactic-history-row-selected');
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
                selected = row.message;
                for (const r of list.children) r.classList.remove('galactic-history-row-selected');
                line.classList.add('galactic-history-row-selected');
                showSelected();
            });
            list.appendChild(line);
        }
    }

    // method_542: RemoveOldHistoryMessages (Empire.cs:4708), then rebind. Keeps the selection when still listed,
    // else selects the first row (the grid's default current row).
    function rebind(): void {
        removeOldHistoryMessages(empire);
        rows = galacticHistoryRows(empire, filter);
        if (selected === null || !rows.some((r) => r.message === selected)) selected = sortHistoryRows(rows, sort)[0]?.message ?? null;
        renderList();
        showSelected();
    }

    function currentHistoryKey(): string {
        const h = empireMessageHistory(empire);
        return `${h.length}:${h.length > 0 ? h[h.length - 1]?.starDate : 0}`;
    }

    select.value = String(filter);
    select.addEventListener('change', () => {
        filter = Number(select.value) as HistoryFilter;
        selected = null;
        rebind();
    });
    hTitle.addEventListener('click', () => {
        sort = nextHistorySort(sort, 'title');
        renderList();
    });
    hDate.addEventListener('click', () => {
        sort = nextHistorySort(sort, 'starDate');
        renderList();
    });
    gotoBtn.addEventListener('click', () => {
        if (selected === null) return;
        const p = messageLocation(selected);
        if (p === null) return;
        onGoTo(p.x, p.y);
        close();
    });

    historyKey = currentHistoryKey();
    rebind();
    // New history entries while open: rebind only when the history changed (no per-tick DOM rebuild).
    const timer = setInterval(() => {
        const k = currentHistoryKey();
        if (k === historyKey) return;
        historyKey = k;
        rebind();
    }, 1000);

    function close(): void {
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
